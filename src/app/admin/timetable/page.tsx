"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { FirebaseError } from "firebase/app";
import { auth, db } from "@/lib/firebase/client";
import { useAuthUser } from "@/lib/firebase/useAuthUser";
import { getUserRole } from "@/lib/roles/getUserRole";
import { qTimetableSlots } from "@/lib/firestore/api";
import { useFirestoreQuery } from "@/lib/firestore/hooks";
import { col } from "@/lib/firestore/paths";
import { computeChargeCents } from "@/lib/billing/fee";
import { useStudentsMap } from "@/lib/students/useStudentsMap";
import { AdminTopNav } from "@/app/admin/_components/AdminTopNav";

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

type Day = (typeof DAYS)[number];

const DAY_TO_WEEKDAY: Record<Day, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 0,
};

const WEEKDAY_TO_DAY: Record<number, Day> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

const DAY_ORDER: Day[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

type SlotStudent = {
  id: string;
  name: string;
};

type SlotDoc = {
  id: string;
  day: Day;
  weekday: number;
  startTime: string;
  endTime: string;
  duration: number;
  students: SlotStudent[];
  notes: string;
  isLocked: boolean;
  recurring: boolean;
  exceptions: string[];
  active: boolean;
};

type SlotDraft = {
  day: Day;
  startTime: string;
  endTime: string;
  studentIds: string[];
  notes: string;
  active: boolean;
};

function toDay(v: unknown): Day {
  if (typeof v === "string" && DAYS.includes(v as Day)) {
    return v as Day;
  }
  const weekday = Number(v);
  return WEEKDAY_TO_DAY[weekday] ?? "Monday";
}

function parseTimeToMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function minutesToTime(min: number) {
  const hh = String(Math.floor(min / 60)).padStart(2, "0");
  const mm = String(min % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function dayIndex(day: Day) {
  return DAY_ORDER.indexOf(day);
}

function normalizeTimeRange(startTime: string, endTime: string) {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start == null || end == null) return null;
  const normalizedEnd = end <= start ? end + 24 * 60 : end;
  return { start, end: normalizedEnd };
}

function computeDuration(startTime: string, endTime: string) {
  const range = normalizeTimeRange(startTime, endTime);
  if (!range) return 0;
  return range.end - range.start;
}

function validateTimeRange(startTime: string, endTime: string) {
  const range = normalizeTimeRange(startTime, endTime);
  if (!range) return "Use valid start/end times.";
  if (range.end <= range.start) return "Use valid start/end times.";
  return null;
}

function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  const aRange = normalizeTimeRange(aStart, aEnd);
  const bRange = normalizeTimeRange(bStart, bEnd);
  if (!aRange || !bRange) return false;
  return aRange.start < bRange.end && bRange.start < aRange.end;
}

function rangeForSlot(day: Day, startTime: string, endTime: string) {
  const range = normalizeTimeRange(startTime, endTime);
  if (!range) return null;
  const start = dayIndex(day) * 24 * 60 + range.start;
  const end = dayIndex(day) * 24 * 60 + range.end;
  return { start, end };
}

function findOverlap(
  slots: SlotDoc[],
  candidate: { id?: string; day: Day; startTime: string; endTime: string },
) {
  const candidateRange = rangeForSlot(candidate.day, candidate.startTime, candidate.endTime);
  if (!candidateRange) return undefined;
  return slots.find(
    (s) =>
      s.id !== candidate.id &&
      s.active &&
      s.students.length > 0 &&
      (() => {
        const slotRange = rangeForSlot(s.day, s.startTime, s.endTime);
        if (!slotRange) return false;
        const week = 7 * 24 * 60;
        const shiftedRanges = [0, -week, week].map((shift) => ({
          start: slotRange.start + shift,
          end: slotRange.end + shift,
        }));
        return shiftedRanges.some((slot) => candidateRange.start < slot.end && slot.start < candidateRange.end);
      })(),
  );
}

function yyyymmdd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function combineDateTimeMs(d: Date, hhmm: string) {
  const [hh, mm] = hhmm.split(":").map((x) => Number(x));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh || 0, mm || 0).getTime();
}

export default function TimetablePage() {
  const router = useRouter();
  const { user, loading } = useAuthUser();
  const [checkingRole, setCheckingRole] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [view, setView] = useState<"calendar" | "list">("calendar");

  const [createDay, setCreateDay] = useState<Day>("Monday");
  const [createStartTime, setCreateStartTime] = useState("16:00");
  const [createEndTime, setCreateEndTime] = useState("17:30");
  const [createStudentIds, setCreateStudentIds] = useState<string[]>([]);
  const [createNotes, setCreateNotes] = useState("");
  const [drafts, setDrafts] = useState<Record<string, SlotDraft>>({});

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setCheckingRole(false);
      router.replace("/login");
      return;
    }
    (async () => {
      const role = await getUserRole(user.uid);
      if (role !== "admin") router.replace("/student");
      setCheckingRole(false);
    })();
  }, [loading, router, user]);

  const ready = !loading && !checkingRole;
  const slotsQuery = useMemo(() => (ready ? qTimetableSlots() : null), [ready]);
  const { data: rawSlots, loading: slotsLoading, error: slotsError } =
    useFirestoreQuery<Record<string, unknown>>(slotsQuery);
  const { students, byId: studentsById } = useStudentsMap(ready);

  const slots: SlotDoc[] = useMemo(
    () =>
      rawSlots.map((s) => ({
        id: String((s as any).id),
        day: toDay((s as any).day ?? (s as any).weekday),
        weekday: Number((s as any).weekday ?? DAY_TO_WEEKDAY[toDay((s as any).day)]),
        startTime: String((s as any).startTime ?? "00:00"),
        endTime: String(
          (s as any).endTime ??
            minutesToTime(
              (parseTimeToMinutes(String((s as any).startTime ?? "00:00")) ?? 0) +
                Number((s as any).duration ?? (s as any).durationMin ?? 60),
            ),
        ),
        duration: Number((s as any).duration ?? (s as any).durationMin ?? 60),
        students: Array.isArray((s as any).students)
          ? ((s as any).students as Array<{ id?: unknown; name?: unknown }>)
              .map((st) => ({
                id: String(st.id ?? ""),
                name: String(st.name ?? studentsById.get(String(st.id ?? ""))?.fullName ?? ""),
              }))
              .filter((st) => st.id)
          : ((s as any).studentId
              ? [
                  {
                    id: String((s as any).studentId),
                    name: studentsById.get(String((s as any).studentId))?.fullName ?? "Student",
                  },
                ]
              : []),
        notes: String((s as any).notes ?? ""),
        isLocked: Boolean((s as any).isLocked ?? true),
        recurring: Boolean((s as any).recurring ?? true),
        exceptions: Array.isArray((s as any).exceptions)
          ? ((s as any).exceptions as unknown[]).map((x) => String(x))
          : [],
        active: Boolean((s as any).active ?? true),
      })),
    [rawSlots, studentsById],
  );

  const sortedSlots = useMemo(() => {
    return [...slots].sort((a, b) => {
      const dayDiff = DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
      if (dayDiff !== 0) return dayDiff;
      return a.startTime.localeCompare(b.startTime);
    });
  }, [slots]);

  const slotsByDay = useMemo(() => {
    const map = new Map<Day, SlotDoc[]>();
    for (const d of DAYS) map.set(d, []);
    for (const s of sortedSlots) {
      map.set(s.day, [...(map.get(s.day) ?? []), s]);
    }
    return map;
  }, [sortedSlots]);

  const calendarSlotsByDay = useMemo(() => {
    const map = new Map<Day, SlotDoc[]>();
    for (const d of DAYS) map.set(d, []);
    for (const s of sortedSlots) {
      map.set(s.day, [...(map.get(s.day) ?? []), s]);
    }
    return map;
  }, [sortedSlots]);

  function getDraft(slot: SlotDoc): SlotDraft {
    return (
      drafts[slot.id] ?? {
        day: slot.day,
        startTime: slot.startTime,
        endTime: slot.endTime,
        studentIds: slot.students.map((st) => st.id),
        notes: slot.notes,
        active: slot.active,
      }
    );
  }

  function updateDraft(slotId: string, patch: Partial<SlotDraft>) {
    setDrafts((prev) => ({
      ...prev,
      [slotId]: {
        ...(prev[slotId] ?? {
          day: "Monday",
          startTime: "16:00",
          endTime: "17:00",
          studentIds: [],
          notes: "",
          active: true,
        }),
        ...patch,
      },
    }));
  }

  async function generateNext7DaysSessions() {
    setError(null);
    const feeCache = new Map<string, number>();
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const wd = d.getDay();
      const slotsForDay = slots.filter((s) => s.active && s.weekday === wd && s.students.length);
      for (const slot of slotsForDay) {
        const startAt = combineDateTimeMs(d, slot.startTime);
        const endAt = startAt + slot.duration * 60_000;
        for (const student of slot.students) {
          const sessionId = `${slot.id}_${student.id}_${yyyymmdd(d)}`;
          const sessionRef = doc(db, col.sessions(), sessionId);
          const existing = await getDoc(sessionRef);
          if (existing.exists()) continue;

          let feePerSessionCents = feeCache.get(student.id);
          if (feePerSessionCents == null) {
            const studentSnap = await getDoc(doc(db, col.students(), student.id));
            feePerSessionCents = studentSnap.exists()
              ? Math.max(0, Math.trunc(Number((studentSnap.data() as any).feePerSessionCents ?? 0)))
              : 0;
            feeCache.set(student.id, feePerSessionCents);
          }

          await setDoc(sessionRef, {
            studentId: student.id,
            slotId: slot.id,
            startAt,
            endAt,
            status: "scheduled",
            feePerSessionCents,
            chargeCents: computeChargeCents({ feePerSessionCents, status: "scheduled" }),
            createdFrom: "timetable",
          });
        }
      }
    }
  }

  async function ensureTodaySessionsForSlot(args: {
    slotId: string;
    day: Day;
    startTime: string;
    duration: number;
    students: SlotStudent[];
  }) {
    const today = new Date();
    if (today.getDay() !== DAY_TO_WEEKDAY[args.day]) return;
    if (args.students.length === 0) return;

    const sessionDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startAt = combineDateTimeMs(sessionDate, args.startTime);
    const endAt = startAt + args.duration * 60_000;
    const feeCache = new Map<string, number>();

    for (const student of args.students) {
      const sessionId = `${args.slotId}_${student.id}_${yyyymmdd(sessionDate)}`;
      const sessionRef = doc(db, col.sessions(), sessionId);
      const existing = await getDoc(sessionRef);
      if (existing.exists()) continue;

      let feePerSessionCents = feeCache.get(student.id);
      if (feePerSessionCents == null) {
        const studentSnap = await getDoc(doc(db, col.students(), student.id));
        feePerSessionCents = studentSnap.exists()
          ? Math.max(0, Math.trunc(Number((studentSnap.data() as any).feePerSessionCents ?? 0)))
          : 0;
        feeCache.set(student.id, feePerSessionCents);
      }

      await setDoc(sessionRef, {
        studentId: student.id,
        slotId: args.slotId,
        startAt,
        endAt,
        status: "scheduled",
        feePerSessionCents,
        chargeCents: computeChargeCents({ feePerSessionCents, status: "scheduled" }),
        createdFrom: "timetable",
      });
    }
  }

  async function deleteFutureSessionsForSlot(slotId: string) {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const q = query(collection(db, col.sessions()), where("slotId", "==", slotId));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      const data = d.data() as { startAt?: unknown };
      const startAt = Number(data.startAt ?? 0);
      if (!Number.isFinite(startAt) || startAt < todayStart) continue;
      await deleteDoc(doc(db, col.sessions(), d.id));
    }
  }

  async function rebuildUpcomingSessionsForSlot(args: {
    slotId: string;
    day: Day;
    startTime: string;
    duration: number;
    students: SlotStudent[];
    daysAhead?: number;
  }) {
    const daysAhead = Math.max(1, args.daysAhead ?? 35);
    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const targetWeekday = DAY_TO_WEEKDAY[args.day];
    const feeCache = new Map<string, number>();

    // Recreate upcoming scheduled sessions from current slot definition.
    if (args.students.length === 0) return;
    for (let i = 0; i < daysAhead; i++) {
      const d = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        startDate.getDate() + i,
      );
      if (d.getDay() !== targetWeekday) continue;

      const startAt = combineDateTimeMs(d, args.startTime);
      const endAt = startAt + args.duration * 60_000;
      for (const student of args.students) {
        let feePerSessionCents = feeCache.get(student.id);
        if (feePerSessionCents == null) {
          const studentSnap = await getDoc(doc(db, col.students(), student.id));
          feePerSessionCents = studentSnap.exists()
            ? Math.max(0, Math.trunc(Number((studentSnap.data() as any).feePerSessionCents ?? 0)))
            : 0;
          feeCache.set(student.id, feePerSessionCents);
        }

        const sessionId = `${args.slotId}_${student.id}_${yyyymmdd(d)}`;
        await setDoc(doc(db, col.sessions(), sessionId), {
          studentId: student.id,
          slotId: args.slotId,
          startAt,
          endAt,
          status: "scheduled",
          feePerSessionCents,
          chargeCents: computeChargeCents({ feePerSessionCents, status: "scheduled" }),
          createdFrom: "timetable",
        });
      }
    }
  }

  async function createSlot(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const timeError = validateTimeRange(createStartTime, createEndTime);
    if (timeError) {
      setError(timeError);
      return;
    }
    const overlap = findOverlap(slots, {
      day: createDay,
      startTime: createStartTime,
      endTime: createEndTime,
    });
    if (overlap) {
      setError(`Overlaps with ${overlap.day} ${overlap.startTime}-${overlap.endTime}.`);
      return;
    }

    const duration = computeDuration(createStartTime, createEndTime);
    if (duration <= 0) {
      setError("Duration must match the selected time range.");
      return;
    }

    const studentsPayload = createStudentIds
      .map((id) => ({ id, name: studentsById.get(id)?.fullName ?? "Student" }))
      .filter((x) => Boolean(x.id));

    try {
      const slotRef = await addDoc(collection(db, col.timetableSlots()), {
        day: createDay,
        weekday: DAY_TO_WEEKDAY[createDay],
        startTime: createStartTime,
        endTime: createEndTime,
        duration,
        durationMin: duration,
        students: studentsPayload,
        studentId: studentsPayload[0]?.id ?? null,
        notes: createNotes.trim(),
        isLocked: true,
        recurring: true,
        exceptions: [],
        active: true,
      });

      await ensureTodaySessionsForSlot({
        slotId: slotRef.id,
        day: createDay,
        startTime: createStartTime,
        duration,
        students: studentsPayload,
      });
      await rebuildUpcomingSessionsForSlot({
        slotId: slotRef.id,
        day: createDay,
        startTime: createStartTime,
        duration,
        students: studentsPayload,
      });

      setCreateStudentIds([]);
      setCreateNotes("");
    } catch (err) {
      if (err instanceof FirebaseError) {
        if (err.code === "permission-denied") {
          setError(
            "Permission denied while creating slot. Ensure Firestore rules are published and your account has admin role.",
          );
          return;
        }
        setError(`${err.code}: ${err.message}`);
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to create slot.");
    }
  }

  async function unlockSlot(slot: SlotDoc) {
    if (
      !window.confirm(
        "This schedule is fixed. Are you sure you want to modify it? Unlock this slot?",
      )
    ) {
      return;
    }
    setSavingId(slot.id);
    setError(null);
    try {
      await updateDoc(doc(db, col.timetableSlots(), slot.id), { isLocked: false });
      setDrafts((prev) => ({
        ...prev,
        [slot.id]: {
          day: slot.day,
          startTime: slot.startTime,
          endTime: slot.endTime,
          studentIds: slot.students.map((st) => st.id),
          notes: slot.notes,
          active: slot.active,
        },
      }));
    } finally {
      setSavingId(null);
    }
  }

  async function saveSlot(slot: SlotDoc) {
    if (slot.isLocked) return;
    const draft = getDraft(slot);
    setError(null);

    const timeError = validateTimeRange(draft.startTime, draft.endTime);
    if (timeError) {
      setError(timeError);
      return;
    }
    if (draft.studentIds.length < 1) {
      setError("At least one student is required per slot.");
      return;
    }

    const duration = computeDuration(draft.startTime, draft.endTime);
    if (duration <= 0) {
      setError("Duration must match the selected time range.");
      return;
    }

    const overlap = findOverlap(slots, {
      id: slot.id,
      day: draft.day,
      startTime: draft.startTime,
      endTime: draft.endTime,
    });
    if (overlap) {
      setError(`Overlaps with ${overlap.day} ${overlap.startTime}-${overlap.endTime}.`);
      return;
    }

    const studentsPayload = draft.studentIds
      .map((id) => ({ id, name: studentsById.get(id)?.fullName ?? "Student" }))
      .filter((x) => Boolean(x.id));
    setSavingId(slot.id);
    try {
      await deleteFutureSessionsForSlot(slot.id);

      await updateDoc(doc(db, col.timetableSlots(), slot.id), {
        day: draft.day,
        weekday: DAY_TO_WEEKDAY[draft.day],
        startTime: draft.startTime,
        endTime: draft.endTime,
        duration,
        durationMin: duration,
        students: studentsPayload,
        studentId: studentsPayload[0]?.id ?? null,
        notes: draft.notes.trim(),
        active: draft.active,
        recurring: true,
        exceptions: slot.exceptions,
      });

      await ensureTodaySessionsForSlot({
        slotId: slot.id,
        day: draft.day,
        startTime: draft.startTime,
        duration,
        students: studentsPayload,
      });
      await rebuildUpcomingSessionsForSlot({
        slotId: slot.id,
        day: draft.day,
        startTime: draft.startTime,
        duration,
        students: studentsPayload,
      });
    } finally {
      setSavingId(null);
    }
  }

  async function lockSlot(slotId: string) {
    setSavingId(slotId);
    try {
      await updateDoc(doc(db, col.timetableSlots(), slotId), { isLocked: true });
    } finally {
      setSavingId(null);
    }
  }

  async function deleteSlot(slotId: string) {
    if (!window.confirm("Delete this slot permanently?")) return;
    setSavingId(slotId);
    setError(null);
    try {
      const existingSlot = slots.find((s) => s.id === slotId);
      let cleanupError: string | null = null;
      if (existingSlot) {
        try {
          await deleteFutureSessionsForSlot(slotId);
        } catch (err) {
          cleanupError = err instanceof Error ? err.message : "Cleanup failed";
        }
      }

      await deleteDoc(doc(db, col.timetableSlots(), slotId));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[slotId];
        return next;
      });

      if (cleanupError) {
        setError(`Slot deleted, but upcoming session cleanup had an issue: ${cleanupError}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete slot.");
    } finally {
      setSavingId(null);
    }
  }

  if (loading || checkingRole) {
    return <div className="text-sm text-[rgb(var(--muted))]">Loading...</div>;
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:px-6 md:py-8">
      <AdminTopNav />

      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="font-semibold">Generate sessions</div>
          <button className="btn btn-ghost" onClick={generateNext7DaysSessions}>
            Rebuild next 7 days
          </button>
        </div>
        <div className="mt-2 text-xs text-[rgb(var(--muted))]">
          Saving a slot auto-generates today’s session and upcoming sessions. Use this only if you need to rebuild manually.
        </div>
      </div>

      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-semibold">Create slot</div>
            <div className="mt-1 text-xs text-[rgb(var(--muted))]">
              Build a weekly class block with optional student assignment.
            </div>
          </div>
          <div className="rounded-lg border border-[rgb(var(--border))] bg-black/5 px-3 py-2 text-xs dark:bg-white/5">
            Selected students: <span className="font-semibold">{createStudentIds.length}</span>
          </div>
        </div>
        <form className="mt-4 grid gap-4 xl:grid-cols-[1fr_320px]" onSubmit={createSlot}>
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <div className="label">Day</div>
                <select
                  className="input"
                  value={createDay}
                  onChange={(e) => setCreateDay(e.target.value as Day)}
                >
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <div className="label">Start time</div>
                <input
                  className="input"
                  value={createStartTime}
                  onChange={(e) => setCreateStartTime(e.target.value)}
                  type="time"
                />
              </div>
              <div className="space-y-1">
                <div className="label">End time</div>
                <input
                  className="input"
                  value={createEndTime}
                  onChange={(e) => setCreateEndTime(e.target.value)}
                  type="time"
                />
              </div>
              <div className="space-y-1">
                <div className="label">Duration</div>
                <div className="input bg-black/5 dark:bg-white/5">
                  {computeDuration(createStartTime, createEndTime)} min
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="label">Students (optional)</div>
              <details className="group rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))]">
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm">
                  <span className="text-[rgb(var(--muted))]">
                    {createStudentIds.length > 0
                      ? `${createStudentIds.length} student(s) selected`
                      : "Assign students now or leave unassigned"}
                  </span>
                  <span className="text-xs text-[rgb(var(--muted))] transition group-open:rotate-180">
                    ▼
                  </span>
                </summary>
                <div className="max-h-44 space-y-1 overflow-auto border-t border-[rgb(var(--border))] p-2">
                  {students
                    .filter((s) => s.active)
                    .map((s) => (
                      <label
                        key={s.id}
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <span>{s.fullName}</span>
                        <input
                          type="checkbox"
                          checked={createStudentIds.includes(s.id)}
                          onChange={(e) => {
                            setCreateStudentIds((prev) =>
                              e.target.checked
                                ? [...prev, s.id]
                                : prev.filter((x) => x !== s.id),
                            );
                          }}
                        />
                      </label>
                    ))}
                </div>
              </details>
            </div>

            <div className="space-y-1">
              <div className="label">Notes (optional)</div>
              <input
                className="input"
                value={createNotes}
                onChange={(e) => setCreateNotes(e.target.value)}
                placeholder="Any special notes"
              />
            </div>
          </div>

          <div className="card p-4">
            <div className="text-sm font-semibold">Slot preview</div>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[rgb(var(--muted))]">When</span>
                <span className="font-medium">{createDay}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[rgb(var(--muted))]">Time</span>
                <span className="font-medium">
                  {createStartTime} - {createEndTime}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[rgb(var(--muted))]">Duration</span>
                <span className="font-medium">{computeDuration(createStartTime, createEndTime)} min</span>
              </div>
              <div className="flex items-center justify-between border-t border-[rgb(var(--border))] pt-2">
                <span className="text-[rgb(var(--muted))]">Students</span>
                <span className="font-semibold">{createStudentIds.length}</span>
              </div>
            </div>
            <button className="btn btn-primary mt-4 w-full">Add slot</button>
          </div>
        </form>
        <div className="mt-2 text-xs text-[rgb(var(--muted))]">
          New slots are locked by default. To edit: Unlock - Edit - Save - Lock.
        </div>
        {error ? <div className="mt-3 text-sm text-red-300">{error}</div> : null}
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Weekly timetable</div>
          <div className="flex items-center gap-2">
            <button
              className={`btn ${view === "calendar" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setView("calendar")}
            >
              Calendar view
            </button>
            <button
              className={`btn ${view === "list" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setView("list")}
            >
              List view
            </button>
          </div>
        </div>
        <div className="mt-2 text-xs text-[rgb(var(--muted))]">
          Locked slots cannot be edited until explicitly unlocked.
        </div>
        {slotsError ? (
          <div className="mt-3 text-sm text-red-300">
            Failed to load timetable slots: {slotsError}
          </div>
        ) : null}

        {view === "calendar" ? (
          <div className="mt-4 grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
            {DAYS.map((day) => {
              const daySlots = calendarSlotsByDay.get(day) ?? [];
              return (
                <div key={day} className="rounded-lg border border-[rgb(var(--border))] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold">{day}</div>
                    <div className="text-xs text-[rgb(var(--muted))]">{daySlots.length} slot{daySlots.length === 1 ? "" : "s"}</div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {daySlots.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-[rgb(var(--border))] p-3 text-sm text-[rgb(var(--muted))]">
                        No timetable blocks for this day.
                      </div>
                    ) : (
                      daySlots.map((slot) => (
                        <div
                          key={slot.id}
                          className={`rounded-lg border p-3 text-sm ${
                            !slot.active
                              ? "border-slate-400/60 bg-slate-500/10 opacity-70 dark:bg-slate-500/15"
                              : slot.isLocked
                                ? "border-[rgb(var(--border))] bg-black/5 opacity-85 dark:bg-white/5"
                                : "border-blue-300 bg-blue-100/50 dark:border-blue-500 dark:bg-blue-900/30"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium">
                                {slot.startTime} - {slot.endTime}
                              </div>
                              <div className="text-xs text-[rgb(var(--muted))]">{slot.duration} min</div>
                            </div>
                            <div className="text-xs font-medium text-[rgb(var(--muted))]">
                              {!slot.active ? "BLOCKED" : slot.isLocked ? "LOCKED" : "EDIT MODE"}
                            </div>
                          </div>
                          <div className="mt-2 text-sm">
                            {!slot.active
                              ? "Unavailable"
                              : slot.students.length > 0
                                ? slot.students.map((st) => st.name).join(", ")
                                : "Unassigned"}
                          </div>
                          {slot.notes ? <div className="mt-1 text-xs text-[rgb(var(--muted))]">{slot.notes}</div> : null}
                          <div className="mt-2 text-xs text-[rgb(var(--muted))]">
                            {slot.active ? "Available" : "Blocked time"}
                          </div>
                          <div className="mt-2 text-xs text-[rgb(var(--muted))]">
                            Edit details in List view.
                          </div>
                          <div className="mt-3 flex justify-end gap-2">
                            {slot.isLocked ? (
                              <button
                                className="btn btn-ghost"
                                disabled={savingId === slot.id}
                                onClick={() => unlockSlot(slot)}
                              >
                                Unlock
                              </button>
                            ) : (
                              <button
                                className="btn btn-ghost"
                                disabled={savingId === slot.id}
                                onClick={() => lockSlot(slot.id)}
                              >
                                Lock
                              </button>
                            )}
                            <button
                              className="btn btn-ghost"
                              disabled={savingId === slot.id}
                              onClick={() => deleteSlot(slot.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 space-y-6">
            {DAYS.map((d) => (
              <div key={d}>
                <div className="mb-2 text-sm font-semibold">{d}</div>
                <div className="space-y-2">
                  {(slotsByDay.get(d) ?? []).map((slot) => {
                    const draft = getDraft(slot);
                    const duration = computeDuration(draft.startTime, draft.endTime);
                    return (
                      <div
                        key={slot.id}
                        className={`rounded-lg border p-3 text-sm ${
                          slot.isLocked
                            ? "border-[rgb(var(--border))] bg-black/5 opacity-85 dark:bg-white/5"
                            : "border-blue-300 bg-blue-100/50 dark:border-blue-500 dark:bg-blue-900/30"
                        }`}
                      >
                        {slot.isLocked ? (
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="font-medium">
                                {slot.startTime} - {slot.endTime} ({slot.duration} min)
                              </div>
                              <div className="text-xs text-[rgb(var(--muted))]">
                                {slot.students.map((st) => st.name).join(", ")}
                              </div>
                              {slot.notes ? (
                                <div className="mt-1 text-xs text-[rgb(var(--muted))]">{slot.notes}</div>
                              ) : null}
                              <div className="mt-1 text-xs font-medium text-[rgb(var(--muted))]">LOCKED</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                className="btn btn-ghost"
                                disabled={savingId === slot.id}
                                onClick={() => unlockSlot(slot)}
                              >
                                Unlock
                              </button>
                              <button
                                className="btn btn-ghost"
                                disabled={savingId === slot.id}
                                onClick={() => deleteSlot(slot.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="text-xs font-semibold text-blue-700 dark:text-blue-300">EDIT MODE</div>
                            <div className="grid gap-2 md:grid-cols-4">
                              <select
                                className="input"
                                value={draft.day}
                                onChange={(e) => updateDraft(slot.id, { day: e.target.value as Day })}
                              >
                                {DAYS.map((day) => (
                                  <option key={day} value={day}>
                                    {day}
                                  </option>
                                ))}
                              </select>
                              <input
                                className="input"
                                type="time"
                                value={draft.startTime}
                                onChange={(e) => updateDraft(slot.id, { startTime: e.target.value })}
                              />
                              <input
                                className="input"
                                type="time"
                                value={draft.endTime}
                                onChange={(e) => updateDraft(slot.id, { endTime: e.target.value })}
                              />
                              <div className="input bg-black/5 text-sm dark:bg-white/5">{duration} min</div>
                            </div>
                            <div className="max-h-36 space-y-1 overflow-auto rounded-lg border border-[rgb(var(--border))] p-2">
                              {students
                                .filter((s) => s.active)
                                .map((s) => (
                                  <label key={s.id} className="flex items-center gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={draft.studentIds.includes(s.id)}
                                      onChange={(e) => {
                                        updateDraft(slot.id, {
                                          studentIds: e.target.checked
                                            ? [...draft.studentIds, s.id]
                                            : draft.studentIds.filter((x) => x !== s.id),
                                        });
                                      }}
                                    />
                                    <span>{s.fullName}</span>
                                  </label>
                                ))}
                            </div>
                            <input
                              className="input"
                              value={draft.notes}
                              onChange={(e) => updateDraft(slot.id, { notes: e.target.value })}
                              placeholder="Notes"
                            />
                            <label className="flex items-center gap-2 text-xs text-[rgb(var(--muted))]">
                              <input
                                type="checkbox"
                                checked={draft.active}
                                onChange={(e) => updateDraft(slot.id, { active: e.target.checked })}
                              />
                              Active
                            </label>
                            <div className="flex items-center justify-end gap-2">
                              <button
                                className="btn btn-primary"
                                disabled={savingId === slot.id}
                                onClick={() => saveSlot(slot)}
                              >
                                Save
                              </button>
                              <button
                                className="btn btn-ghost"
                                disabled={savingId === slot.id}
                                onClick={() => lockSlot(slot.id)}
                              >
                                Lock
                              </button>
                              <button
                                className="btn btn-ghost"
                                disabled={savingId === slot.id}
                                onClick={() => deleteSlot(slot.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {(slotsByDay.get(d) ?? []).length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[rgb(var(--border))] p-3 text-xs text-[rgb(var(--muted))]">
                      No slots.
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {slotsLoading ? (
          <div className="mt-3 text-center text-sm text-[rgb(var(--muted))]">Loading...</div>
        ) : null}
        {!slotsLoading && sortedSlots.length === 0 ? (
          <div className="mt-3 text-center text-sm text-[rgb(var(--muted))]">No slots yet.</div>
        ) : null}
      </div>
    </div>
  );
}

