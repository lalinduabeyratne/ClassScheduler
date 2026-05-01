"use client";

import { addDoc, collection, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { col } from "@/lib/firestore/paths";
import { useMemo, useState } from "react";
import { AdminTopNav } from "@/app/admin/_components/AdminTopNav";
import { db } from "@/lib/firebase/client";
import { qSessionsBetween, qStudents } from "@/lib/firestore/api";
import { useFirestoreQuery } from "@/lib/firestore/hooks";
import { useStudentsMap } from "@/lib/students/useStudentsMap";
import type { AttendanceStatus, Session } from "@/lib/model/types";

function startOfDayMs(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const MISSED_STATUSES: AttendanceStatus[] = ["early_cancel", "late_cancel", "no_show", "tutor_cancel"];

function formatDateTime(ms: number) {
  return new Intl.DateTimeFormat("en-LK", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
}

function statusLabel(status: AttendanceStatus) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function AdminMissedPage() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [makeupDate, setMakeupDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [makeupTime, setMakeupTime] = useState("18:00");
  const [makeupDurationMin, setMakeupDurationMin] = useState("60");
  const [markOriginalAttended, setMarkOriginalAttended] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
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

  const selectedCount = selectedIds.size;
  const selectedSessions = useMemo(() => missed.filter((s) => selectedIds.has(s.id)), [missed, selectedIds]);
  const selectedStudentCount = useMemo(() => new Set(selectedSessions.map((s) => s.studentId)).size, [selectedSessions]);
  const statusCounts = useMemo(
    () => ({
      tutorCancel: missed.filter((s) => s.status === "tutor_cancel").length,
      earlyCancel: missed.filter((s) => s.status === "early_cancel").length,
      lateCancel: missed.filter((s) => s.status === "late_cancel").length,
      noShow: missed.filter((s) => s.status === "no_show").length,
    }),
    [missed],
  );

  function toggleSelect(id: string) {
    setSelectedIds((s) => {
      const copy = new Set(s);
      if (copy.has(id)) copy.delete(id);
      else copy.add(id);
      return copy;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(missed.map((m) => m.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function combineDateTimeMs(dateValue: string, timeValue: string) {
    return new Date(`${dateValue}T${timeValue}:00`).getTime();
  }

  async function createMakeupForSelected() {
    setActionError(null);
    if (selectedIds.size === 0) {
      setActionError("Select at least one missed session.");
      return;
    }
    const duration = Math.trunc(Number(makeupDurationMin));
    if (!Number.isFinite(duration) || duration <= 0) {
      setActionError("Enter a valid duration in minutes.");
      return;
    }

    try {
      for (const s of selectedSessions) {
        const startAt = combineDateTimeMs(makeupDate, makeupTime);
        const docRef = await addDoc(collection(db, col.sessions()), {
          studentId: s.studentId,
          startAt,
          endAt: startAt + duration * 60 * 1000,
          status: "scheduled",
          feePerSessionCents: s.feePerSessionCents ?? 0,
          chargeCents: 0,
          createdFrom: "makeup",
          createdFromSessionId: s.id,
          createdAt: Date.now(),
        });

        const updatePayload: any = {
          coverupStatus: "scheduled",
          coverupSessionId: docRef.id,
          coverupScheduledFor: startAt,
          coverupScheduledAt: Date.now(),
        };

        if (markOriginalAttended) {
          updatePayload.status = "attended";
          updatePayload.chargeCents = s.feePerSessionCents ?? 0;
          updatePayload.statusUpdatedAt = Date.now();
        }

        await updateDoc(doc(db, "sessions", s.id), updatePayload);
      }
      clearSelection();
      window.alert("Make-up sessions created.");
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : "Failed to create make-up sessions.");
    }
  }

  async function markAsMadeUp(session: Session) {
    try {
      await updateDoc(doc(db, "sessions", session.id), {
        status: "attended",
        chargeCents: session.feePerSessionCents ?? 0,
        statusUpdatedAt: Date.now(),
        coverupStatus: "completed",
        coverupCompletedAt: Date.now(),
      });
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

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      <AdminTopNav />

      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Missed classes</div>
            <div className="mt-1 text-sm text-[rgb(var(--muted))]">
              All sessions marked early cancel, late cancel, no-show, or tutor-cancel.
            </div>
          </div>
          <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-3">
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

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-3">
            <div className="text-xs text-[rgb(var(--muted))]">Total missed</div>
            <div className="mt-1 text-xl font-semibold">{missed.length}</div>
          </div>
          <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-3">
            <div className="text-xs text-[rgb(var(--muted))]">Tutor cancel</div>
            <div className="mt-1 text-xl font-semibold text-indigo-400">{statusCounts.tutorCancel}</div>
          </div>
          <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-3">
            <div className="text-xs text-[rgb(var(--muted))]">No show</div>
            <div className="mt-1 text-xl font-semibold text-rose-400">{statusCounts.noShow}</div>
          </div>
          <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-3">
            <div className="text-xs text-[rgb(var(--muted))]">Selected sessions</div>
            <div className="mt-1 text-xl font-semibold">{selectedCount}</div>
          </div>
          <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-3">
            <div className="text-xs text-[rgb(var(--muted))]">Selected students</div>
            <div className="mt-1 text-xl font-semibold">{selectedStudentCount}</div>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-3">
            <div className="text-sm font-semibold">Bulk make-up action</div>
            <div className="mt-1 text-xs text-[rgb(var(--muted))]">
              Creates new scheduled make-up sessions for all selected rows. Optional: mark originals as attended.
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="btn btn-ghost" onClick={selectAll}>Select all</button>
            <button className="btn btn-ghost" onClick={clearSelection}>Clear selection</button>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <input type="date" className="input" value={makeupDate} onChange={(e) => setMakeupDate(e.target.value)} />
              <input type="time" className="input max-w-[120px]" value={makeupTime} onChange={(e) => setMakeupTime(e.target.value)} />
              <input className="input max-w-[120px]" value={makeupDurationMin} onChange={(e) => setMakeupDurationMin(e.target.value)} inputMode="numeric" placeholder="mins" />
              <label className="text-sm text-[rgb(var(--muted))] flex items-center gap-2">
                <input type="checkbox" checked={markOriginalAttended} onChange={(e) => setMarkOriginalAttended(e.target.checked)} /> Mark originals attended
              </label>
              <button className="btn btn-primary" onClick={() => void createMakeupForSelected()} disabled={selectedCount === 0}>
                Create make-up classes
              </button>
            </div>
            </div>
            {actionError ? <div className="mt-2 text-sm text-red-300">{actionError}</div> : null}
          </div>

          {sessionsLoading ? (
            <div className="text-sm text-[rgb(var(--muted))]">Loading...</div>
          ) : missed.length === 0 ? (
            <div className="text-sm text-[rgb(var(--muted))]">No missed classes found.</div>
          ) : (
            missed.map((s) => (
              <div key={s.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <label className="mb-2 inline-flex items-center gap-2 text-xs text-[rgb(var(--muted))]">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(s.id)}
                        onChange={() => toggleSelect(s.id)}
                      />
                      Select for bulk make-up
                    </label>
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
                  <button className="btn btn-primary" onClick={() => void markAsMadeUp(s)}>
                    Mark as completed
                  </button>
                  <button className="btn btn-ghost" onClick={() => void removeSession(s)}>Delete</button>
                </div>
                {s.coverupStatus === "scheduled" ? (
                  <div className="mt-2 text-sm text-[rgb(var(--muted))]">Make-up scheduled for {formatDateTime(s.coverupScheduledFor ?? 0)}.</div>
                ) : s.coverupStatus === "completed" ? (
                  <div className="mt-2 text-sm text-[rgb(var(--muted))]">Missed covered on {formatDateTime(s.coverupCompletedAt ?? 0)}.</div>
                ) : (
                  <div className="mt-2 text-xs text-[rgb(var(--muted))]">Mark as completed changes this missed session to attended and applies the session fee.</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
