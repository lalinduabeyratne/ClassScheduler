"use client";

import { collection, deleteDoc, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AdminTopNav } from "@/app/admin/_components/AdminTopNav";
import { computeChargeCents } from "@/lib/billing/fee";
import { db } from "@/lib/firebase/client";
import { useAuthUser } from "@/lib/firebase/useAuthUser";
import { getUserRole } from "@/lib/roles/getUserRole";
import { qSessionsBetween } from "@/lib/firestore/api";
import { useFirestoreQuery } from "@/lib/firestore/hooks";
import { col } from "@/lib/firestore/paths";
import type { AttendanceStatus, Session } from "@/lib/model/types";
import { useStudentsMap } from "@/lib/students/useStudentsMap";

function startOfDayMs(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function yyyymmdd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayLabel(ms: number) {
  return new Intl.DateTimeFormat("en-LK", {
    weekday: "short",
    month: "short",
    day: "2-digit",
  }).format(new Date(ms));
}

function timeLabel(ms: number) {
  return new Intl.DateTimeFormat("en-LK", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

function timeInputValue(ms: number) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function AdminCalendarPage() {
  const router = useRouter();
  const { user, loading } = useAuthUser();
  const [checkingRole, setCheckingRole] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(yyyymmdd(new Date()));
  const [rangeDays, setRangeDays] = useState(7);
  const [statusFilter, setStatusFilter] = useState<"all" | AttendanceStatus>("all");
  const [studentFilter, setStudentFilter] = useState<string>("all");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editSavingId, setEditSavingId] = useState<string | null>(null);

  const startMs = useMemo(() => startOfDayMs(new Date(`${selectedDate}T00:00:00`)), [selectedDate]);
  const endMs = useMemo(() => startMs + rangeDays * 24 * 60 * 60 * 1000, [rangeDays, startMs]);

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
        if (role !== "admin") router.replace("/student");
      } catch (err) {
        setAccessError(
          err instanceof Error
            ? err.message
            : "Firestore denied access while checking the admin role.",
        );
        router.replace("/login");
      } finally {
        setCheckingRole(false);
      }
    })();
  }, [loading, router, user]);

  const ready = !loading && !checkingRole && !accessError;
  const sessionsQuery = useMemo(
    () => (ready ? qSessionsBetween({ startAtMs: startMs, endAtMs: endMs }) : null),
    [endMs, ready, startMs],
  );
  const { data: sessions } = useFirestoreQuery<Session>(sessionsQuery);
  const { students, byId: studentsById } = useStudentsMap(ready);

  const filteredSessions = useMemo(() => {
    return sessions.filter((session) => {
      if (statusFilter !== "all" && session.status !== statusFilter) return false;
      if (studentFilter !== "all" && session.studentId !== studentFilter) return false;
      return true;
    });
  }, [sessions, statusFilter, studentFilter]);

  const grouped = useMemo(() => {
    const m = new Map<string, Session[]>();
    for (const s of filteredSessions) {
      const key = new Date(s.startAt).toDateString();
      m.set(key, [...(m.get(key) ?? []), s]);
    }
    return m;
  }, [filteredSessions]);

  async function updateSessionStatus(session: Session, status: AttendanceStatus) {
    setActionError(null);
    const now = Date.now();
    if (session.startAt > now && status !== "scheduled") {
      setActionError("Future sessions can only stay as scheduled.");
      return;
    }
    if (session.feePerSessionCents <= 0) {
      setActionError("Cannot update fee: session has no valid fee snapshot.");
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
  }

  async function deleteSession(sessionId: string) {
    if (!window.confirm("Delete this session record?")) return;
    setActionError(null);
    await deleteDoc(doc(db, col.sessions(), sessionId));
  }

  async function deleteLinkedSlot(slotId: string) {
    if (
      !window.confirm(
        "Delete linked timetable slot? This removes the recurring slot definition.",
      )
    ) {
      return;
    }
    setActionError(null);
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const sessionsForSlot = query(collection(db, col.sessions()), where("slotId", "==", slotId));
    const sessionsSnap = await getDocs(sessionsForSlot);
    for (const d of sessionsSnap.docs) {
      const data = d.data() as { startAt?: unknown };
      const startAt = Number(data.startAt ?? 0);
      if (!Number.isFinite(startAt) || startAt < todayStart) continue;
      await deleteDoc(doc(db, col.sessions(), d.id));
    }
    await deleteDoc(doc(db, col.timetableSlots(), slotId));
  }

  function openEditTime(session: Session) {
    setEditingSessionId(session.id);
    setEditStartTime(timeInputValue(session.startAt));
    setEditEndTime(timeInputValue(session.endAt));
    setActionError(null);
  }

  async function saveEditTime() {
    setActionError(null);
    if (!editingSessionId) return;
    const session = sessions.find((s) => s.id === editingSessionId);
    if (!session) return;

    const [startHh, startMm] = editStartTime.split(":").map(Number);
    const [endHh, endMm] = editEndTime.split(":").map(Number);
    if (!Number.isFinite(startHh) || !Number.isFinite(startMm) || !Number.isFinite(endHh) || !Number.isFinite(endMm)) {
      setActionError("Invalid time format.");
      return;
    }

    const sessionDate = new Date(session.startAt);
    const newStartAt = new Date(
      sessionDate.getFullYear(),
      sessionDate.getMonth(),
      sessionDate.getDate(),
      startHh,
      startMm,
    ).getTime();

    const newEndAt = new Date(
      sessionDate.getFullYear(),
      sessionDate.getMonth(),
      sessionDate.getDate(),
      endHh,
      endMm,
    ).getTime();

    if (newEndAt <= newStartAt) {
      setActionError("End time must be after start time.");
      return;
    }

    // Handle overnight if needed: if end < start time-wise, put end on next day
    let finalEndAt = newEndAt;
    if (newEndAt <= newStartAt) {
      finalEndAt = newEndAt + 24 * 60 * 60 * 1000;
    }

    setEditSavingId(editingSessionId);
    try {
      await updateDoc(doc(db, col.sessions(), editingSessionId), {
        startAt: newStartAt,
        endAt: finalEndAt,
      });
      setEditingSessionId(null);
      setEditStartTime("");
      setEditEndTime("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update session time.");
    } finally {
      setEditSavingId(null);
    }
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
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <div className="label">Start date</div>
            <input
              className="input"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <div className="label">Range</div>
            <select
              className="input"
              value={rangeDays}
              onChange={(e) => setRangeDays(Number(e.target.value))}
            >
              <option value={1}>1 day</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>
          <div className="space-y-1">
            <div className="label">Status filter</div>
            <select
              className="input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | AttendanceStatus)}
            >
              <option value="all">All</option>
              <option value="scheduled">Scheduled</option>
              <option value="attended">Attended</option>
              <option value="tutor_cancel">Tutor cancel</option>
              <option value="early_cancel">Early cancel</option>
              <option value="late_cancel">Late cancel</option>
              <option value="no_show">No show</option>
            </select>
          </div>
          <div className="space-y-1">
            <div className="label">Student filter</div>
            <select
              className="input"
              value={studentFilter}
              onChange={(e) => setStudentFilter(e.target.value)}
            >
              <option value="all">All students</option>
              {students
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="text-xs text-[rgb(var(--muted))]">Matched sessions: {filteredSessions.length}</div>
          <button className="btn btn-ghost" onClick={() => setSelectedDate(yyyymmdd(new Date()))}>
            Jump to today
          </button>
        </div>
      </div>

      {actionError ? <div className="text-sm text-red-300">{actionError}</div> : null}

      {editingSessionId ? (
        <div className="card p-6">
          <div className="font-semibold">Edit session time</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <div className="label">Start time</div>
              <input
                className="input"
                type="time"
                value={editStartTime}
                onChange={(e) => setEditStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <div className="label">End time</div>
              <input
                className="input"
                type="time"
                value={editEndTime}
                onChange={(e) => setEditEndTime(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setEditingSessionId(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => void saveEditTime()} disabled={editSavingId === editingSessionId}>
              {editSavingId === editingSessionId ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : null}

      {grouped.size === 0 ? (
        <div className="card p-6 text-sm text-[rgb(var(--muted))]">
          No sessions in this filtered range.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from(grouped.entries()).map(([key, daySessions]) => (
            <div key={key} className="card p-6">
              <div className="font-semibold">{dayLabel(daySessions[0]!.startAt)}</div>
              <ul className="mt-3 space-y-2 text-sm">
                {daySessions.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">
                        {timeLabel(s.startAt)} - {timeLabel(s.endAt)}
                      </div>
                      <div className="text-xs text-[rgb(var(--muted))]">
                        {studentsById.get(s.studentId)?.fullName ?? s.studentId}
                      </div>
                    </div>
                    <div className="space-y-1">
                      {s.startAt > Date.now() ? (
                        <div className="input min-w-[150px] text-center">scheduled</div>
                      ) : (
                        <select
                          className="input min-w-[150px]"
                          value={s.status === "scheduled" ? "attended" : s.status}
                          onChange={(e) =>
                            void updateSessionStatus(s, e.target.value as AttendanceStatus)
                          }
                        >
                          <option value="attended">Attended</option>
                          <option value="tutor_cancel">Tutor cancel</option>
                          <option value="early_cancel">Early cancel</option>
                          <option value="late_cancel">Late cancel</option>
                          <option value="no_show">No show</option>
                        </select>
                      )}
                      <div className="text-right text-xs text-[rgb(var(--muted))]">
                        {new Intl.NumberFormat("en-LK", {
                          style: "currency",
                          currency: "LKR",
                          maximumFractionDigits: 2,
                        }).format((s.chargeCents ?? 0) / 100)}
                      </div>
                      <div className="flex justify-end gap-2">
                        <button className="btn btn-ghost" onClick={() => openEditTime(s)}>
                          Edit time
                        </button>
                        <button className="btn btn-ghost" onClick={() => void deleteSession(s.id)}>
                          Delete session
                        </button>
                        {s.slotId ? (
                          <button
                            className="btn btn-ghost"
                            onClick={() => void deleteLinkedSlot(String(s.slotId))}
                          >
                            Delete slot
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

