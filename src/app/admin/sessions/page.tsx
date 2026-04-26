"use client";

import { addDoc, collection, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AdminTopNav } from "@/app/admin/_components/AdminTopNav";
import { computeChargeCents } from "@/lib/billing/fee";
import { db } from "@/lib/firebase/client";
import { useAuthUser } from "@/lib/firebase/useAuthUser";
import { qSessionsBetween, qStudents } from "@/lib/firestore/api";
import { useFirestoreQuery } from "@/lib/firestore/hooks";
import { col } from "@/lib/firestore/paths";
import type { AttendanceStatus, Session } from "@/lib/model/types";
import { getUserRole } from "@/lib/roles/getUserRole";
import { useStudentsMap } from "@/lib/students/useStudentsMap";

function startOfDayMs(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayInputValue(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMoneyLKR(cents: number) {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 2,
  }).format((cents ?? 0) / 100);
}

function combineDateTimeMs(dateValue: string, timeValue: string) {
  return new Date(`${dateValue}T${timeValue}:00`).getTime();
}

function statusClass(active: boolean, status: AttendanceStatus) {
  if (status === "scheduled") {
    return active
      ? "bg-sky-600 border-sky-600 text-white"
      : "border-sky-400 text-sky-700 dark:text-sky-300";
  }
  if (status === "attended") {
    return active
      ? "bg-emerald-600 border-emerald-600 text-white"
      : "border-emerald-400 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "tutor_cancel") {
    return active
      ? "bg-indigo-600 border-indigo-600 text-white"
      : "border-indigo-400 text-indigo-700 dark:text-indigo-300";
  }
  if (status === "late_cancel") {
    return active
      ? "bg-amber-500 border-amber-500 text-black"
      : "border-amber-400 text-amber-700 dark:text-amber-300";
  }
  if (status === "no_show") {
    return active
      ? "bg-rose-600 border-rose-600 text-white"
      : "border-rose-400 text-rose-700 dark:text-rose-300";
  }
  return active
    ? "bg-slate-700 border-slate-700 text-white"
    : "border-slate-400 text-slate-700 dark:text-slate-300";
}

function statusLabel(status: AttendanceStatus) {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export default function AdminSessionsHistoryPage() {
  const router = useRouter();
  const { user, loading } = useAuthUser();
  const [checkingRole, setCheckingRole] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(dayInputValue(new Date()));
  const [dateScope, setDateScope] = useState<"day" | "all">("day");
  const [studentFilter, setStudentFilter] = useState<string>("all");
  const [newSessionDate, setNewSessionDate] = useState(dayInputValue(new Date()));
  const [newSessionDates, setNewSessionDates] = useState<string[]>([]);
  const [newSessionStudentId, setNewSessionStudentId] = useState("");
  const [newSessionTime, setNewSessionTime] = useState("18:00");
  const [newSessionTimeUnknown, setNewSessionTimeUnknown] = useState(false);
  const [newSessionDurationMin, setNewSessionDurationMin] = useState("60");
  const [newSessionStatus, setNewSessionStatus] = useState<AttendanceStatus>("attended");
  const [newSessionNotes, setNewSessionNotes] = useState("");
  const [creatingSession, setCreatingSession] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    session: Session;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [pendingStatusUndo, setPendingStatusUndo] = useState<{
    sessionId: string;
    prevStatus: AttendanceStatus;
    prevChargeCents: number;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setCheckingRole(false);
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
        if (role !== "admin") {
          router.replace("/student");
          return;
        }
      } catch (err) {
        setAccessError(err instanceof Error ? err.message : "Role check failed.");
        router.replace("/login");
      } finally {
        setCheckingRole(false);
      }
    })();
  }, [loading, router, user]);

  const dayRange = useMemo(() => {
    const parsed = new Date(`${selectedDate}T00:00:00`);
    const startAtMs = startOfDayMs(parsed);
    const endAtMs = startAtMs + 24 * 60 * 60 * 1000;
    return { startAtMs, endAtMs };
  }, [selectedDate]);

  const range = useMemo(() => {
    if (dateScope === "all") {
      return {
        startAtMs: new Date(2020, 0, 1).getTime(),
        endAtMs: new Date(2035, 0, 1).getTime(),
      };
    }
    return dayRange;
  }, [dateScope, dayRange]);

  const ready = !loading && !checkingRole && !accessError;
  const sessionsQuery = useMemo(
    () => (ready ? qSessionsBetween({ startAtMs: range.startAtMs, endAtMs: range.endAtMs }) : null),
    [range.endAtMs, range.startAtMs, ready],
  );
  const studentsQuery = useMemo(() => (ready ? qStudents() : null), [ready]);

  const { data: sessions, loading: sessionsLoading } = useFirestoreQuery<Session>(sessionsQuery);
  const { data: students } = useFirestoreQuery<Record<string, unknown>>(studentsQuery);
  const { byId: studentsById } = useStudentsMap(ready);

  const studentRows = useMemo(
    () =>
      students.map((student: any) => ({
        id: String(student.id),
        fullName: String(student.fullName ?? student.id),
        feePerSessionCents: Math.max(0, Math.trunc(Number(student.feePerSessionCents ?? 0))),
        sessionDurationMin: Math.max(1, Math.trunc(Number(student.sessionDurationMin ?? 60))),
      })),
    [students],
  );

  useEffect(() => {
    if (newSessionStudentId) return;
    if (studentRows.length === 0) return;
    setNewSessionStudentId(studentRows[0].id);
    setNewSessionDurationMin(String(studentRows[0].sessionDurationMin));
  }, [newSessionStudentId, studentRows]);

  const selectedStudent = useMemo(
    () => studentRows.find((student) => student.id === newSessionStudentId) ?? null,
    [newSessionStudentId, studentRows],
  );

  const selectedBackfillDates = useMemo(
    () =>
      (newSessionDates.length > 0 ? newSessionDates : [newSessionDate])
        .filter((d, i, arr) => d && arr.indexOf(d) === i)
        .sort(),
    [newSessionDate, newSessionDates],
  );

  const parsedDurationMin = Math.trunc(Number(newSessionDurationMin));
  const canCreateBackfill = Boolean(
    newSessionStudentId
      && selectedBackfillDates.length > 0
      && (newSessionTimeUnknown || newSessionTime)
      && Number.isFinite(parsedDurationMin)
      && parsedDurationMin > 0,
  );
  const projectedChargeCents = useMemo(() => {
    if (!selectedStudent) return 0;
    return computeChargeCents({
      feePerSessionCents: selectedStudent.feePerSessionCents,
      status: newSessionStatus,
    });
  }, [newSessionStatus, selectedStudent]);
  const projectedTotalCents = projectedChargeCents * selectedBackfillDates.length;

  const filteredSessions = useMemo(() => {
    const byStudent = studentFilter === "all"
      ? sessions
      : sessions.filter((session) => session.studentId === studentFilter);
    return [...byStudent].sort((a, b) => b.startAt - a.startAt);
  }, [sessions, studentFilter]);

  useEffect(() => {
    return () => {
      if (pendingDelete) {
        clearTimeout(pendingDelete.timeoutId);
      }
      if (pendingStatusUndo) {
        clearTimeout(pendingStatusUndo.timeoutId);
      }
    };
  }, [pendingDelete, pendingStatusUndo]);

  async function updateStatus(session: Session, status: AttendanceStatus) {
    setActionError(null);
    if (pendingStatusUndo && pendingStatusUndo.sessionId !== session.id) {
      clearTimeout(pendingStatusUndo.timeoutId);
      setPendingStatusUndo(null);
    }
    if (session.feePerSessionCents <= 0) {
      setActionError("This session has no valid fee snapshot. Set student fee and regenerate session.");
      return;
    }

    const chargeCents = computeChargeCents({
      feePerSessionCents: session.feePerSessionCents,
      status,
    });

    await updateDoc(doc(db, "sessions", session.id), {
      status,
      chargeCents,
      statusUpdatedAt: Date.now(),
    });

    if (pendingStatusUndo && pendingStatusUndo.sessionId === session.id) {
      clearTimeout(pendingStatusUndo.timeoutId);
    }
    const timeoutId = setTimeout(() => {
      setPendingStatusUndo((current) => (current?.sessionId === session.id ? null : current));
    }, 8000);
    setPendingStatusUndo({
      sessionId: session.id,
      prevStatus: session.status,
      prevChargeCents: session.chargeCents,
      timeoutId,
    });
  }

  async function undoStatusChange() {
    if (!pendingStatusUndo) return;
    clearTimeout(pendingStatusUndo.timeoutId);
    setActionError(null);
    try {
      await updateDoc(doc(db, "sessions", pendingStatusUndo.sessionId), {
        status: pendingStatusUndo.prevStatus,
        chargeCents: pendingStatusUndo.prevChargeCents,
        statusUpdatedAt: Date.now(),
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to undo status update.");
    } finally {
      setPendingStatusUndo(null);
    }
  }

  async function createBackfilledSession() {
    setActionError(null);
    if (!newSessionStudentId) {
      setActionError("Pick a student first.");
      return;
    }

    const student = selectedStudent;
    if (!student) {
      setActionError("Selected student not found.");
      return;
    }

    const targetDates = newSessionDates.length > 0
      ? Array.from(new Set(newSessionDates)).filter(Boolean)
      : [newSessionDate].filter(Boolean);
    if (targetDates.length === 0) {
      setActionError("Select at least one class date.");
      return;
    }

    const effectiveTime = newSessionTimeUnknown ? "12:00" : newSessionTime;
    const invalidDate = targetDates.find((d) => Number.isNaN(combineDateTimeMs(d, effectiveTime)));
    if (invalidDate) {
      setActionError("Enter valid class date and time.");
      return;
    }

    const durationMin = Math.trunc(Number(newSessionDurationMin));
    if (!Number.isFinite(durationMin) || durationMin <= 0) {
      setActionError("Duration must be greater than 0 minutes.");
      return;
    }

    if (student.feePerSessionCents <= 0) {
      setActionError("This student does not have a fee rate set yet.");
      return;
    }

    const feePerSessionCents = student.feePerSessionCents;
    const chargeCents = computeChargeCents({ feePerSessionCents, status: newSessionStatus });
    const trimmedNotes = newSessionNotes.trim();
    const effectiveNotes = newSessionTimeUnknown
      ? trimmedNotes
        ? `Time unknown. ${trimmedNotes}`
        : "Time unknown."
      : trimmedNotes;

    setCreatingSession(true);
    try {
      for (const targetDate of targetDates) {
        const sessionStartAt = combineDateTimeMs(targetDate, effectiveTime);
        await addDoc(collection(db, col.sessions()), {
          studentId: student.id,
          startAt: sessionStartAt,
          endAt: sessionStartAt + durationMin * 60 * 1000,
          status: newSessionStatus,
          statusUpdatedAt: Date.now(),
          feePerSessionCents,
          chargeCents,
          createdFrom: "manual",
          ...(effectiveNotes ? { notes: effectiveNotes } : {}),
        });
      }
      setNewSessionNotes("");
      setNewSessionStatus("attended");
      setNewSessionDates([]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to create the backfilled session.");
    } finally {
      setCreatingSession(false);
    }
  }

  async function deleteSession(session: Session) {
    if (pendingDelete) {
      setActionError("A delete is already pending. Undo or wait a few seconds.");
      return;
    }
    setActionError(null);

    const timeoutId = setTimeout(async () => {
      try {
        await deleteDoc(doc(db, col.sessions(), session.id));
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to delete session.");
      } finally {
        setPendingDelete((current) => (current?.session.id === session.id ? null : current));
      }
    }, 8000);

    setPendingDelete({ session, timeoutId });
  }

  function undoDeleteSession() {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timeoutId);
    setPendingDelete(null);
  }

  if (loading || checkingRole) {
    return <div className="text-sm text-[rgb(var(--muted))]">Loading...</div>;
  }

  if (accessError) {
    return <div className="text-sm text-red-300">{accessError}</div>;
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:px-6 md:py-8">
      <AdminTopNav />

      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-semibold">Backfill a past class</div>
            <p className="mt-1 text-sm text-[rgb(var(--muted))]">
              Log missed entries quickly with multiple dates, status, and charge preview.
            </p>
          </div>
          <div className="text-xs text-[rgb(var(--muted))]">
            {selectedBackfillDates.length} date{selectedBackfillDates.length > 1 ? "s" : ""} selected
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-1 md:col-span-2 xl:col-span-1">
                <div className="label">Student</div>
                <select
                  className="input"
                  value={newSessionStudentId}
                  onChange={(e) => setNewSessionStudentId(e.target.value)}
                >
                  {studentRows.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <div className="label">Class date</div>
                <input
                  className="input"
                  type="date"
                  value={newSessionDate}
                  onChange={(e) => setNewSessionDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <div className="label">Duration (minutes)</div>
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={newSessionDurationMin}
                  onChange={(e) => setNewSessionDurationMin(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  if (!newSessionDate) return;
                  setNewSessionDates((prev) =>
                    prev.includes(newSessionDate) ? prev : [...prev, newSessionDate].sort(),
                  );
                }}
              >
                Add selected date
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() - 1);
                  const y = dayInputValue(d);
                  setNewSessionDates((prev) => (prev.includes(y) ? prev : [...prev, y].sort()));
                }}
              >
                Add yesterday
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setNewSessionDates([])}
              >
                Clear dates
              </button>
            </div>

            <div className="space-y-1">
              <div className="label">Time</div>
              <input
                className="input max-w-[220px]"
                type="time"
                value={newSessionTime}
                onChange={(e) => setNewSessionTime(e.target.value)}
                disabled={newSessionTimeUnknown}
              />
              <label className="mt-2 flex items-center gap-2 text-xs text-[rgb(var(--muted))]">
                <input
                  type="checkbox"
                  checked={newSessionTimeUnknown}
                  onChange={(e) => setNewSessionTimeUnknown(e.target.checked)}
                />
                I don't remember the exact time
              </label>
            </div>

            <div className="space-y-2">
              <div className="label">Status</div>
              <div className="flex flex-wrap gap-2">
                {(["attended", "tutor_cancel", "late_cancel", "early_cancel", "no_show"] as AttendanceStatus[]).map(
                  (status) => (
                    <button
                      key={status}
                      type="button"
                      className={`btn ${statusClass(newSessionStatus === status, status)}`}
                      onClick={() => setNewSessionStatus(status)}
                    >
                      {status.replaceAll("_", " ")}
                    </button>
                  ),
                )}
              </div>
            </div>

            <div className="space-y-1">
              <div className="label">Notes</div>
              <input
                className="input"
                value={newSessionNotes}
                onChange={(e) => setNewSessionNotes(e.target.value)}
                placeholder="Optional note about this backfilled class"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {selectedBackfillDates.map((d) => (
                <span
                  key={d}
                  className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-1 text-xs"
                >
                  {d}
                  <button
                    type="button"
                    className="text-[rgb(var(--muted))] hover:text-red-300"
                    onClick={() => {
                      if (newSessionDates.length === 0) return;
                      setNewSessionDates((prev) => prev.filter((x) => x !== d));
                    }}
                    aria-label={`Remove ${d}`}
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className="card p-4">
            <div className="text-sm font-semibold">Summary</div>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[rgb(var(--muted))]">Student</span>
                <span className="font-medium">{selectedStudent?.fullName ?? "-"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[rgb(var(--muted))]">Dates</span>
                <span className="font-medium">{selectedBackfillDates.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[rgb(var(--muted))]">Status</span>
                <span className="font-medium">{newSessionStatus.replaceAll("_", " ")}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[rgb(var(--muted))]">Per session</span>
                <span className="font-medium">{formatMoneyLKR(projectedChargeCents)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-[rgb(var(--border))] pt-2">
                <span className="text-[rgb(var(--muted))]">Projected total</span>
                <span className="font-semibold">{formatMoneyLKR(projectedTotalCents)}</span>
              </div>
            </div>

            <button
              className="btn btn-primary mt-4 w-full"
              onClick={() => void createBackfilledSession()}
              disabled={creatingSession || !canCreateBackfill}
            >
              {creatingSession ? "Creating..." : `Add ${selectedBackfillDates.length} session(s)`}
            </button>
            <div className="mt-2 text-xs text-[rgb(var(--muted))]">
              {canCreateBackfill
                ? "Ready to save."
                : "Choose student, date, and valid duration to enable save."}
            </div>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[220px_220px_220px_1fr] xl:items-end">
          <div className="space-y-1">
            <div className="label">Date scope</div>
            <select
              className="input"
              value={dateScope}
              onChange={(e) => setDateScope(e.target.value as "day" | "all")}
            >
              <option value="day">Selected date</option>
              <option value="all">All dates</option>
            </select>
          </div>
          <div className="space-y-1">
            <div className="label">Date</div>
            <input
              className="input"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              disabled={dateScope === "all"}
            />
          </div>
          <div className="space-y-1">
            <div className="label">Student</div>
            <select
              className="input"
              value={studentFilter}
              onChange={(e) => setStudentFilter(e.target.value)}
            >
              <option value="all">All students</option>
              {studentRows.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="text-xs text-[rgb(var(--muted))]">
            Sessions found: {sessionsLoading ? "..." : filteredSessions.length}
          </div>
        </div>
      </div>

      {actionError ? (
        <div className="text-sm text-red-300" aria-live="polite">
          {actionError}
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200" aria-live="polite">
          Session on {new Date(pendingDelete.session.startAt).toLocaleString()} queued for delete.
          <button className="btn btn-ghost ml-3" onClick={undoDeleteSession}>
            Undo
          </button>
        </div>
      ) : null}

      {pendingStatusUndo ? (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-200" aria-live="polite">
          Status updated. Click undo to restore previous value.
          <button className="btn btn-ghost ml-3" onClick={() => void undoStatusChange()}>
            Undo
          </button>
        </div>
      ) : null}

      <div className="card p-6">
        <div className="font-semibold">
          {dateScope === "all" ? "Sessions on all dates" : `Sessions on ${selectedDate}`}
        </div>
        <div className="mt-3 grid gap-3 md:hidden">
          {filteredSessions.map((session) => {
            const sessionDate = new Date(session.startAt);
            const studentName = studentsById.get(session.studentId)?.fullName ?? session.studentId;

            return (
              <div key={session.id} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{studentName}</div>
                    <div className="text-xs text-[rgb(var(--muted))] font-mono">{session.studentId}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-[rgb(var(--muted))]">Charge</div>
                    <div className="font-semibold">{formatMoneyLKR(session.chargeCents)}</div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-[rgb(var(--muted))]">Date</div>
                    <div className="font-medium">{sessionDate.toLocaleDateString()}</div>
                  </div>
                  <div>
                    <div className="text-[rgb(var(--muted))]">Time</div>
                    <div className="font-medium">{sessionDate.toLocaleTimeString()}</div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <span className={`status-pill ${session.status === "scheduled" ? "status-scheduled" : session.status === "attended" ? "status-attended" : session.status === "tutor_cancel" ? "status-tutor-cancel" : session.status === "late_cancel" ? "status-late-cancel" : session.status === "early_cancel" ? "status-early-cancel" : "status-no-show"}`}>
                    {statusLabel(session.status)}
                  </span>
                </div>

                <div className="mt-4 grid gap-2">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {(["scheduled", "attended", "tutor_cancel", "late_cancel", "no_show", "early_cancel"] as AttendanceStatus[]).map((status) => (
                      <button
                        key={status}
                        className={`btn w-full ${statusClass(session.status === status, status)}`}
                        onClick={() => void updateStatus(session, status)}
                      >
                        {statusLabel(status)}
                      </button>
                    ))}
                  </div>
                  <button
                    className="btn btn-ghost w-full"
                    onClick={() => void deleteSession(session)}
                    disabled={pendingDelete?.session.id === session.id}
                  >
                    {pendingDelete?.session.id === session.id ? "Pending..." : "Delete session"}
                  </button>
                </div>
              </div>
            );
          })}

          {!sessionsLoading && filteredSessions.length === 0 ? (
            <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-4 text-center text-sm text-[rgb(var(--muted))]">
              <div>No sessions found for this filter.</div>
              <div className="mt-2">
                <button
                  className="btn btn-ghost w-full"
                  onClick={() => {
                    setDateScope("all");
                    setStudentFilter("all");
                  }}
                >
                  Show all sessions
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="text-left text-[rgb(var(--muted))]">
              <tr className="border-b border-[rgb(var(--border))]">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Time</th>
                <th className="py-2 pr-3">Student</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3 text-right">Charge</th>
                <th className="py-2 pr-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSessions.map((session) => (
                <tr key={session.id} className="border-b border-[rgb(var(--border))]">
                  <td className="py-2 pr-3">{new Date(session.startAt).toLocaleDateString()}</td>
                  <td className="py-2 pr-3">{new Date(session.startAt).toLocaleTimeString()}</td>
                  <td className="py-2 pr-3">
                    <div className="font-medium">
                      {studentsById.get(session.studentId)?.fullName ?? session.studentId}
                    </div>
                    <div className="text-xs text-[rgb(var(--muted))] font-mono">{session.studentId}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-2">
                      {(["scheduled", "attended", "tutor_cancel", "late_cancel", "no_show", "early_cancel"] as AttendanceStatus[]).map(
                        (status) => (
                          <button
                            key={status}
                            className={`btn ${statusClass(session.status === status, status)}`}
                            onClick={() => void updateStatus(session, status)}
                          >
                            {status.replaceAll("_", " ")}
                          </button>
                        ),
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold">
                    {formatMoneyLKR(session.chargeCents)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <button
                      className="btn btn-ghost"
                      onClick={() => void deleteSession(session)}
                      disabled={pendingDelete?.session.id === session.id}
                    >
                      {pendingDelete?.session.id === session.id ? "Pending..." : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}

              {!sessionsLoading && filteredSessions.length === 0 ? (
                <tr>
                  <td className="py-6 text-center text-[rgb(var(--muted))]" colSpan={6}>
                    <div>No sessions found for this filter.</div>
                    <div className="mt-2">
                      <button
                        className="btn btn-ghost"
                        onClick={() => {
                          setDateScope("all");
                          setStudentFilter("all");
                        }}
                      >
                        Show all sessions
                      </button>
                    </div>
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
