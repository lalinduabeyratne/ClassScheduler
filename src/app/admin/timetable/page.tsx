"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebase/client";
import { useAuthUser } from "@/lib/firebase/useAuthUser";
import { getUserRole } from "@/lib/roles/getUserRole";
import { qTimetableSlots } from "@/lib/firestore/api";
import { useFirestoreQuery } from "@/lib/firestore/hooks";
import { col } from "@/lib/firestore/paths";
import { computeChargeCents } from "@/lib/billing/fee";
import { useStudentsMap } from "@/lib/students/useStudentsMap";

type SlotDoc = {
  id: string;
  weekday: number;
  startTime: string;
  durationMin: number;
  studentId: string | null;
  active: boolean;
};

function weekdayLabel(n: number) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][n] ?? String(n);
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

  const [weekday, setWeekday] = useState(1);
  const [startTime, setStartTime] = useState("16:00");
  const [durationMin, setDurationMin] = useState(90);
  const [studentId, setStudentId] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!user) {
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
  const { data: rawSlots, loading: slotsLoading } =
    useFirestoreQuery<Record<string, unknown>>(slotsQuery);
  const { students, byId: studentsById } = useStudentsMap(ready);

  const slots: SlotDoc[] = useMemo(
    () =>
      rawSlots.map((s) => ({
        id: String((s as any).id),
        weekday: Number((s as any).weekday ?? 0),
        startTime: String((s as any).startTime ?? "00:00"),
        durationMin: Number((s as any).durationMin ?? 60),
        studentId: ((s as any).studentId ?? null) as string | null,
        active: Boolean((s as any).active ?? true),
      })),
    [rawSlots],
  );

  async function generateNext7DaysSessions() {
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const wd = d.getDay();
      const slotsForDay = slots.filter((s) => s.active && s.weekday === wd && s.studentId);
      for (const slot of slotsForDay) {
        const startAt = combineDateTimeMs(d, slot.startTime);
        const endAt = startAt + slot.durationMin * 60_000;
        const sessionId = `${slot.id}_${yyyymmdd(d)}`;
        const sessionRef = doc(db, col.sessions(), sessionId);
        const existing = await getDoc(sessionRef);
        if (existing.exists()) continue;

        // Fee snapshot: read current student fee (optional). If missing, default to 0.
        const studentSnap = await getDoc(doc(db, col.students(), slot.studentId!));
        const feePerSessionCents = studentSnap.exists()
          ? Math.max(0, Math.trunc(Number((studentSnap.data() as any).feePerSessionCents ?? 0)))
          : 0;

        await setDoc(sessionRef, {
          studentId: slot.studentId,
          slotId: slot.id,
          startAt,
          endAt,
          status: "attended",
          feePerSessionCents,
          chargeCents: computeChargeCents({ feePerSessionCents, status: "attended" }),
          createdFrom: "timetable",
        });
      }
    }
  }

  if (loading || checkingRole) {
    return <div className="text-sm text-[rgb(var(--muted))]">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Weekly timetable</div>
            <div className="mt-1 text-sm text-[rgb(var(--muted))]">
              Fixed weekly slots (admin-only). Generate upcoming sessions from this timetable.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a className="btn btn-ghost" href="/admin">
              Back
            </a>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await signOut(auth);
                router.replace("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="font-semibold">Generate sessions</div>
          <button className="btn btn-primary" onClick={generateNext7DaysSessions}>
            Generate next 7 days
          </button>
        </div>
        <div className="mt-2 text-xs text-[rgb(var(--muted))]">
          This creates `sessions` if they don’t already exist (id = `slotId_YYYYMMDD`).
        </div>
      </div>

      <div className="card p-6">
        <div className="font-semibold">Add slot</div>
        <form
          className="mt-4 grid gap-3 md:grid-cols-5"
          onSubmit={async (e) => {
            e.preventDefault();
            await addDoc(collection(db, col.timetableSlots()), {
              weekday,
              startTime,
              durationMin,
              studentId: studentId.trim() ? studentId.trim() : null,
              active: true,
            });
            setStudentId("");
          }}
        >
          <div className="space-y-1">
            <div className="label">Weekday</div>
            <select
              className="input"
              value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value))}
            >
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>
                  {weekdayLabel(d)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <div className="label">Start time</div>
            <input
              className="input"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              type="time"
            />
          </div>
          <div className="space-y-1">
            <div className="label">Duration (min)</div>
            <input
              className="input"
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
              type="number"
              min={15}
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <div className="label">Student (optional)</div>
            <select
              className="input"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {students
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName} ({s.id})
                  </option>
                ))}
            </select>
          </div>
          <div className="md:col-span-5 flex justify-end">
            <button className="btn btn-primary">Add slot</button>
          </div>
        </form>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Slots</div>
          <a className="btn btn-ghost" href="/admin/timetable">
            Refresh
          </a>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[rgb(var(--muted))]">
              <tr className="border-b border-[rgb(var(--border))]">
                <th className="py-2 pr-3">Day</th>
                <th className="py-2 pr-3">Time</th>
                <th className="py-2 pr-3">Duration</th>
                <th className="py-2 pr-3">Student</th>
                <th className="py-2 pr-3">Active</th>
                <th className="py-2 pr-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => (
                <tr key={s.id} className="border-b border-[rgb(var(--border))]">
                  <td className="py-2 pr-3">{weekdayLabel(s.weekday)}</td>
                  <td className="py-2 pr-3">{s.startTime}</td>
                  <td className="py-2 pr-3">{s.durationMin} min</td>
                  <td className="py-2 pr-3">
                    <div className="space-y-1">
                      <div className="text-xs text-[rgb(var(--muted))]">
                        {s.studentId
                          ? studentsById.get(s.studentId)?.fullName ?? "Student"
                          : "Unassigned"}
                      </div>
                      <select
                        className="input"
                        value={s.studentId ?? ""}
                        onChange={async (e) => {
                          await updateDoc(doc(db, col.timetableSlots(), s.id), {
                            studentId: e.target.value.trim()
                              ? e.target.value.trim()
                              : null,
                          });
                        }}
                      >
                        <option value="">Unassigned</option>
                        {students
                          .filter((st) => st.active)
                          .map((st) => (
                            <option key={st.id} value={st.id}>
                              {st.fullName} ({st.id})
                            </option>
                          ))}
                      </select>
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="checkbox"
                      checked={s.active}
                      onChange={async (e) => {
                        await updateDoc(doc(db, col.timetableSlots(), s.id), {
                          active: e.target.checked,
                        });
                      }}
                    />
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <button
                      className="btn btn-ghost"
                      onClick={async () => {
                        await deleteDoc(doc(db, col.timetableSlots(), s.id));
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {slotsLoading ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-[rgb(var(--muted))]">
                    Loading…
                  </td>
                </tr>
              ) : null}
              {!slotsLoading && slots.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-[rgb(var(--muted))]">
                    No slots yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

