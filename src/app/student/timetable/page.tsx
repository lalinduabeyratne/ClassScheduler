"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuthUser } from "@/lib/firebase/useAuthUser";
import { getUserDoc, qTimetableSlots } from "@/lib/firestore/api";
import { useFirestoreQuery } from "@/lib/firestore/hooks";
import { getUserRole } from "@/lib/roles/getUserRole";
import { describeTimetableException } from "@/lib/timetable/describeException";
import type { Weekday } from "@/lib/model/types";
import { StudentTopNav } from "@/app/student/_components/StudentTopNav";

const DAYS: Weekday[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const LEGACY_WEEKDAY_TO_DAY: Record<number, Weekday> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

type SlotView = {
  id: string;
  day: Weekday;
  startTime: string;
  endTime: string;
  duration: number;
  students: { id: string; name: string }[];
  notes: string;
  exceptions: string[];
  active: boolean;
};

function toDayField(raw: Record<string, unknown>): Weekday {
  if (typeof raw.day === "string" && DAYS.includes(raw.day as Weekday)) {
    return raw.day as Weekday;
  }
  const w = Number(raw.weekday);
  return LEGACY_WEEKDAY_TO_DAY[Number.isFinite(w) ? w : -1] ?? "Monday";
}

function parseSlot(id: string, raw: Record<string, unknown>): SlotView {
  const studentsIn = Array.isArray(raw.students)
    ? (raw.students as unknown[]).map((st) => {
        if (st && typeof st === "object" && st !== null && "id" in st) {
          const o = st as { id?: unknown; name?: unknown };
          return { id: String(o.id ?? ""), name: String(o.name ?? "") };
        }
        return { id: "", name: "" };
      })
    : [];
  const legacyId = raw.studentId != null && String(raw.studentId).length > 0 ? String(raw.studentId) : "";
  const fromArray = studentsIn.filter((s) => s.id);
  let students = fromArray.length > 0 ? fromArray : legacyId ? [{ id: legacyId, name: "Class" }] : [];
  if (legacyId && !students.some((s) => s.id === legacyId)) {
    students = [...students, { id: legacyId, name: "Class" }];
  }

  const startTime = String(raw.startTime ?? "00:00");
  const endTime = String(raw.endTime ?? "00:00");
  const duration = Math.max(
    0,
    Math.trunc(
      Number(raw.duration ?? raw.durationMin ?? 0) ||
        (() => {
          // fallback from times if duration missing
          const toMin = (t: string) => {
            const m = t.match(/^(\d{2}):(\d{2})$/);
            if (!m) return 0;
            return Number(m[1]) * 60 + Number(m[2]);
          };
          return Math.max(0, toMin(endTime) - toMin(startTime));
        })(),
    ),
  );

  return {
    id,
    day: toDayField(raw),
    startTime,
    endTime,
    duration,
    students,
    notes: String(raw.notes ?? "").trim(),
    exceptions: Array.isArray(raw.exceptions)
      ? (raw.exceptions as unknown[]).map((x) => String(x))
      : [],
    active: Boolean(raw.active ?? true),
  };
}

export default function StudentTimetablePage() {
  const router = useRouter();
  const { user, loading } = useAuthUser();
  const [checkingRole, setCheckingRole] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [studentId, setStudentId] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    (async () => {
      try {
        const role = await getUserRole(user.uid);
        if (!role) {
          setAccessError("Your account has no Firestore role document yet.");
          router.replace("/login");
          return;
        }
        if (role !== "student") {
          router.replace("/admin");
          return;
        }
        const u = await getUserDoc(user.uid);
        setStudentId(u?.studentId ?? null);
      } catch (err) {
        setAccessError(
          err instanceof Error
            ? err.message
            : "Firestore denied access while checking the student role.",
        );
        router.replace("/login");
      } finally {
        setCheckingRole(false);
      }
    })();
  }, [loading, router, user]);

  const ready = !loading && !checkingRole && !accessError;
  const slotsQuery = useMemo(() => (ready ? qTimetableSlots() : null), [ready]);
  const { data: rawSlots, loading: slotsLoading, error: slotsError } = useFirestoreQuery<Record<string, unknown>>(
    slotsQuery,
  );

  const allParsed = useMemo(() => {
    return rawSlots.map((row) => {
      const r = row as Record<string, unknown> & { id: string };
      return parseSlot(r.id, r);
    });
  }, [rawSlots]);

  /** Full active weekly schedule (same as admin’s weekly view scope). */
  const scheduleSlots = useMemo(() => {
    return allParsed
      .filter((s) => s.active)
      .sort((a, b) => {
        const dayDiff = DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
        if (dayDiff !== 0) return dayDiff;
        return a.startTime.localeCompare(b.startTime);
      });
  }, [allParsed]);

  const byDay = useMemo(() => {
    const m = new Map<Weekday, SlotView[]>();
    for (const d of DAYS) m.set(d, []);
    for (const s of scheduleSlots) m.set(s.day, [...(m.get(s.day) ?? []), s]);
    return m;
  }, [scheduleSlots]);

  function slotIsMine(slot: SlotView): boolean {
    if (!studentId) return false;
    return slot.students.some((st) => st.id === studentId);
  }

  if (loading || checkingRole) {
    return <div className="text-sm text-[rgb(var(--muted))]">Loading...</div>;
  }

  if (accessError) {
    return <div className="text-sm text-red-300">{accessError}</div>;
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:px-6 md:py-8">
      <StudentTopNav />

      <div className="card p-6">
        <div className="text-lg font-semibold">Full weekly timetable</div>
        <p className="mt-1 text-sm text-[rgb(var(--muted))]">
          The complete class schedule. Slots you are in are highlighted. If a slot has <strong>exceptions</strong>{" "}
          (one-off time changes, cancellations, or notes from the tutor), they appear under that block. Your{" "}
          <strong>Calendar</strong> page still shows the actual booked sessions.
        </p>
        {!studentId ? (
          <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">
            Your account is not linked to a student ID yet, so we cannot highlight &ldquo;your&rdquo; slots. You can
            still see the full schedule. Ask the tutor to set your <code>studentId</code> in Firestore to enable
            highlighting.
          </p>
        ) : null}
        {slotsError ? (
          <p className="mt-3 text-sm text-red-300" role="alert">
            {slotsError}
          </p>
        ) : null}
      </div>

      {slotsLoading ? (
        <div className="text-sm text-[rgb(var(--muted))]">Loading timetable…</div>
      ) : scheduleSlots.length === 0 ? (
        <div className="card p-6 text-sm text-[rgb(var(--muted))]">
          No active slots on the weekly timetable yet. The tutor can add them under Admin → Timetable.
        </div>
      ) : (
        <div className="space-y-4">
          {DAYS.map((day) => {
            const list = byDay.get(day) ?? [];
            if (list.length === 0) return null;
            return (
              <div key={day} className="card p-6">
                <div className="text-base font-semibold">{day}</div>
                <div className="mt-3 space-y-3">
                  {list.map((slot) => {
                    const mine = slotIsMine(slot);
                    return (
                    <div
                      key={slot.id}
                      className={`rounded-lg border p-4 ${
                        mine
                          ? "border-[rgb(var(--brand))] bg-[rgb(var(--brand))]/8 ring-1 ring-[rgb(var(--brand))]/25"
                          : "border-[rgb(var(--border))] bg-[rgb(var(--card))]"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <span className="text-lg font-medium">
                            {slot.startTime} – {slot.endTime}
                          </span>
                          {slot.duration > 0 ? (
                            <span className="ml-2 text-sm text-[rgb(var(--muted))]">{slot.duration} min</span>
                          ) : null}
                        </div>
                        {mine ? (
                          <span className="shrink-0 rounded-full bg-[rgb(var(--brand))] px-2.5 py-0.5 text-xs font-medium text-white">
                            Your class
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-[rgb(var(--fg))]">
                        <span className="text-[rgb(var(--muted))]">Class: </span>
                        {slot.students.length > 0
                          ? slot.students.map((st) => st.name || st.id).join(", ")
                          : "Unassigned"}
                      </p>
                      {slot.notes ? (
                        <p className="mt-2 text-sm text-[rgb(var(--muted))]">{slot.notes}</p>
                      ) : null}
                      {slot.exceptions.length > 0 ? (
                        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                          <div className="font-medium text-amber-900 dark:text-amber-100">Exceptions</div>
                          <ul className="mt-1 list-inside list-disc space-y-1 text-amber-900/90 dark:text-amber-50/90">
                            {slot.exceptions.map((ex) => (
                              <li key={ex}>{describeTimetableException(ex)}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
