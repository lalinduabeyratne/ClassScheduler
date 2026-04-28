"use client";

import { deleteDoc, doc, updateDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AdminTopNav } from "@/app/admin/_components/AdminTopNav";
import { db } from "@/lib/firebase/client";
import { qSessionsBetween, qStudents } from "@/lib/firestore/api";
import { useFirestoreQuery } from "@/lib/firestore/hooks";
import { useStudentsMap } from "@/lib/students/useStudentsMap";

function startOfDayMs(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
import type { AttendanceStatus, Session } from "@/lib/model/types";

const MISSED_STATUSES: AttendanceStatus[] = ["early_cancel", "late_cancel", "no_show", "tutor_cancel"];

function formatDateTime(ms: number) {
  return new Intl.DateTimeFormat("en-LK", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
}

function statusLabel(status: AttendanceStatus) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function AdminMissedPage() {
  const router = useRouter();
  const [dateScope, setDateScope] = useState<"day" | "all">("day");
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [studentFilter, setStudentFilter] = useState<string>("all");

  const day = useMemo(() => {
    const parsed = new Date(`${selectedDate}T00:00:00`);
    const startAtMs = startOfDayMs(parsed);
    const endAtMs = startAtMs + 24 * 60 * 60 * 1000;
    return { startAtMs, endAtMs };
  }, [selectedDate]);

  const range = useMemo(() => {
    if (dateScope === "all") return { startAtMs: new Date(2020, 0, 1).getTime(), endAtMs: new Date(2035, 0, 1).getTime() };
    return day;
  }, [dateScope, day]);

  const sessionsQuery = useMemo(() => qSessionsBetween({ startAtMs: range.startAtMs, endAtMs: range.endAtMs }), [range.startAtMs, range.endAtMs]);
  const studentsQuery = useMemo(() => qStudents(), []);

  const { data: sessions, loading: sessionsLoading } = useFirestoreQuery<Session>(sessionsQuery);
  const { byId: studentsById } = useStudentsMap(true);
  const { data: students } = useFirestoreQuery(studentsQuery);

  const missed = useMemo(() => {
    if (!sessions) return [] as Session[];
    let list = sessions.filter((s) => MISSED_STATUSES.includes(s.status));
    if (studentFilter !== "all") list = list.filter((s) => s.studentId === studentFilter);
    return list.sort((a, b) => b.startAt - a.startAt);
  }, [sessions, studentFilter]);

  async function markAsMadeUp(session: Session) {
    try {
      await updateDoc(doc(db, "sessions", session.id), { status: "attended", chargeCents: session.feePerSessionCents ?? 0, statusUpdatedAt: Date.now() });
    } catch (err) {
      console.error(err);
    }
  }

  async function removeSession(session: Session) {
    const ok = window.confirm("Delete this session? This cannot be undone.");
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "sessions", session.id));
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    // Ensure students list loads for filter select
  }, []);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      <AdminTopNav />

      <div className="card p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Missed classes</div>
            <div className="mt-1 text-sm text-[rgb(var(--muted))]">All sessions marked missed or tutor-cancelled.</div>
          </div>
          <div className="flex items-center gap-3">
            <select className="input" value={dateScope} onChange={(e) => setDateScope(e.target.value as any)}>
              <option value="day">Selected date</option>
              <option value="all">All dates</option>
            </select>
            <input className="input" type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} disabled={dateScope === "all"} />
            <select className="input" value={studentFilter} onChange={(e) => setStudentFilter(e.target.value)}>
              <option value="all">All students</option>
              {students?.map((s: any) => (
                <option key={s.id} value={s.id}>{s.fullName}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {sessionsLoading ? (
            <div className="text-sm text-[rgb(var(--muted))]">Loading...</div>
          ) : missed.length === 0 ? (
            <div className="text-sm text-[rgb(var(--muted))]">No missed classes found.</div>
          ) : (
            missed.map((s) => (
              <div key={s.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{studentsById.get(s.studentId)?.fullName ?? s.studentId}</div>
                    <div className="text-xs text-[rgb(var(--muted))] font-mono">{s.studentId}</div>
                    <div className="mt-1 text-xs text-[rgb(var(--muted))]">{formatDateTime(s.startAt)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-[rgb(var(--muted))]">Status</div>
                    <div className="font-medium">{statusLabel(s.status)}</div>
                    <div className="mt-2 text-sm font-semibold">{new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format((s.chargeCents ?? 0) / 100)}</div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button className="btn btn-primary" onClick={() => void markAsMadeUp(s)}>Mark made-up</button>
                  <button className="btn btn-ghost" onClick={() => void removeSession(s)}>Delete</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
