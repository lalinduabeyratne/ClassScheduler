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

function statusLabel(status: AttendanceStatus | "scheduled") {
  switch (status) {
    case "attended":
      return "Attended";
    case "tutor_cancel":
      return "Tutor cancel";
    case "early_cancel":
      return "Early cancel";
    case "late_cancel":
      return "Late cancel";
    case "no_show":
      return "No show";
    default:
      return "Scheduled";
  }
}

function eventStatusClass(status: AttendanceStatus | "scheduled") {
  if (status === "scheduled") return "status-scheduled";
  return `status-${status.replace("_", "-")}`;
}

function minutesFromDayStart(ms: number) {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

type SlotGroupLayout = {
  key: string;
  sessions: Session[];
  startMinutes: number;
  endMinutes: number;
  lane: number;
  laneCount: number;
};

function computeSlotGroupLayouts(slotGroups: Array<{ key: string; sessions: Session[] }>) {
  const intervals = slotGroups
    .map((group) => {
      const first = group.sessions[0];
      if (!first) return null;
      const startMinutes = minutesFromDayStart(first.startAt);
      let endMinutes = minutesFromDayStart(first.endAt);
      if (endMinutes <= startMinutes) endMinutes += 24 * 60;
      return { ...group, startMinutes, endMinutes };
    })
    .filter((v): v is { key: string; sessions: Session[]; startMinutes: number; endMinutes: number } => Boolean(v))
    .sort((a, b) => a.startMinutes - b.startMinutes);

  const laneEndTimes: number[] = [];
  const layouts: SlotGroupLayout[] = [];
  let active: Array<{ index: number; endMinutes: number; lane: number }> = [];

  for (let i = 0; i < intervals.length; i += 1) {
    const interval = intervals[i]!;
    active = active.filter((a) => a.endMinutes > interval.startMinutes);

    let lane = laneEndTimes.findIndex((end) => end <= interval.startMinutes);
    if (lane === -1) {
      lane = laneEndTimes.length;
      laneEndTimes.push(interval.endMinutes);
    } else {
      laneEndTimes[lane] = interval.endMinutes;
    }

    const current = { index: i, endMinutes: interval.endMinutes, lane };
    const cluster = [...active, current];
    const laneCount = Math.max(1, cluster.length);

    for (const item of cluster) {
      const existing = layouts[item.index];
      if (!existing) continue;
      existing.laneCount = Math.max(existing.laneCount, laneCount);
    }

    layouts[i] = {
      key: interval.key,
      sessions: interval.sessions,
      startMinutes: interval.startMinutes,
      endMinutes: interval.endMinutes,
      lane,
      laneCount,
    };

    active.push(current);
  }

  return layouts;
}

export default function AdminCalendarPage() {
  const VIEW_START_HOUR = 6;
  const BASE_VIEW_END_HOUR = 22;
  const PIXELS_PER_MINUTE = 1.15;
  const SLOT_MINUTES = 30;
  const DAY_HEADER_HEIGHT_PX = 58;

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
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const startMs = useMemo(() => startOfDayMs(new Date(`${selectedDate}T00:00:00`)), [selectedDate]);
  const endMs = useMemo(() => startMs + rangeDays * 24 * 60 * 60 * 1000, [rangeDays, startMs]);

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

  const calendarDays = useMemo(() => {
    const days: Array<{ key: string; dateMs: number; sessions: Session[] }> = [];
    for (let i = 0; i < rangeDays; i += 1) {
      const dateMs = startMs + i * 24 * 60 * 60 * 1000;
      const key = new Date(dateMs).toDateString();
      const sessionsForDay = [...(grouped.get(key) ?? [])].sort((a, b) => a.startAt - b.startAt);
      days.push({ key, dateMs, sessions: sessionsForDay });
    }
    return days;
  }, [grouped, rangeDays, startMs]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  const viewEndHour = useMemo(() => {
    const latestEndMinutes = sessions.reduce((max, s) => {
      const startMinutes = minutesFromDayStart(s.startAt);
      let endMinutes = minutesFromDayStart(s.endAt);
      if (endMinutes <= startMinutes) endMinutes += 24 * 60;
      return Math.max(max, endMinutes);
    }, BASE_VIEW_END_HOUR * 60);
    return Math.min(30, Math.max(BASE_VIEW_END_HOUR, Math.ceil(latestEndMinutes / 60) + 1));
  }, [sessions]);

  const timeLabels = useMemo(() => {
    const labels: Array<{ minutes: number; label: string }> = [];
    for (let h = VIEW_START_HOUR; h <= viewEndHour; h += 1) {
      const d = new Date();
      d.setHours(h % 24, 0, 0, 0);
      labels.push({
        minutes: h * 60,
        label: new Intl.DateTimeFormat("en-LK", { hour: "numeric" }).format(d),
      });
    }
    return labels;
  }, [viewEndHour]);

  const slotMinutes = useMemo(() => {
    const start = VIEW_START_HOUR * 60;
    const end = viewEndHour * 60;
    const mins: number[] = [];
    for (let m = start; m < end; m += SLOT_MINUTES) mins.push(m);
    return mins;
  }, [viewEndHour]);

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
    setActiveSessionId(null);
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

    if (newEndAt === newStartAt) {
      setActionError("End time must be different from start time.");
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
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-7xl items-center justify-center px-4 py-6 md:px-6 md:py-8">
        <div className="card w-full max-w-md p-6 text-center">
          <div className="text-lg font-semibold">Loading calendar</div>
          <div className="mt-2 text-sm text-[rgb(var(--muted))]">
            Fetching your timetable and permissions.
          </div>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[rgb(var(--border))]">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-[rgb(var(--brand))]" />
          </div>
        </div>
      </div>
    );
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

      {calendarDays.every((d) => d.sessions.length === 0) ? (
        <div className="card p-6 text-sm text-[rgb(var(--muted))]">
          No sessions in this filtered range.
        </div>
      ) : (
        <>
          <section className="card p-4 md:hidden">
            <div className="space-y-4">
              {calendarDays.map((day) => (
                <div key={day.key} className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-3">
                  <div className="flex items-center justify-between border-b border-[rgb(var(--border))] pb-2">
                    <div className="text-sm font-semibold">
                      {new Intl.DateTimeFormat("en-LK", { weekday: "long", month: "short", day: "2-digit" }).format(new Date(day.dateMs))}
                    </div>
                    <div className="text-xs text-[rgb(var(--muted))]">{day.sessions.length} session{day.sessions.length === 1 ? "" : "s"}</div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {day.sessions.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-[rgb(var(--border))] px-3 py-2 text-xs text-[rgb(var(--muted))]">
                        No sessions
                      </div>
                    ) : (
                      (() => {
                        const slotGroups = new Map<string, Session[]>();
                        for (const session of day.sessions) {
                          const key = `${session.startAt}-${session.endAt}`;
                          slotGroups.set(key, [...(slotGroups.get(key) ?? []), session]);
                        }

                        return Array.from(slotGroups.values()).map((group) => {
                          const first = group[0]!;
                          const allSameStatus = group.every((s) => s.status === first.status);
                          const blockStatus: AttendanceStatus | "scheduled" = allSameStatus ? first.status : "scheduled";
                          const displayNames = group
                            .map((s) => studentsById.get(s.studentId)?.fullName ?? s.studentId)
                            .join(", ");

                          return (
                            <button
                              key={`${first.startAt}-${first.endAt}-${first.id}`}
                              type="button"
                              className={`w-full rounded-lg border p-3 text-left ${group.some((s) => s.id === activeSessionId) ? "border-[rgb(var(--brand))]" : "border-[rgb(var(--border))]"}`}
                              onClick={() => setActiveSessionId(first.id)}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="text-xs text-[rgb(var(--muted))]">
                                    {timeLabel(first.startAt)} - {timeLabel(first.endAt)}
                                  </div>
                                  <div className="mt-1 text-sm font-semibold">{displayNames}</div>
                                </div>
                                <span className={`status-pill ${eventStatusClass(blockStatus)}`}>
                                  {statusLabel(blockStatus)}
                                </span>
                              </div>
                            </button>
                          );
                        });
                      })()
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="hidden overflow-hidden md:block card">
            <div className="admin-cal-timegrid">
              <div className="admin-cal-gutter">
                {timeLabels.map((t) => (
                  <div
                    key={t.minutes}
                    className="admin-cal-gutter-label"
                    style={{
                      top: `${DAY_HEADER_HEIGHT_PX + (t.minutes - VIEW_START_HOUR * 60) * PIXELS_PER_MINUTE}px`,
                    }}
                  >
                    {t.label}
                  </div>
                ))}
              </div>
              <div
                className="admin-cal-grid"
                style={{ gridTemplateColumns: `repeat(${calendarDays.length}, minmax(220px, 1fr))` }}
              >
              {calendarDays.map((day) => (
                <div key={day.key} className="admin-cal-day">
                  <div className="admin-cal-day-head">
                    <p className="admin-cal-day-week">
                      {new Intl.DateTimeFormat("en-LK", { weekday: "short" }).format(new Date(day.dateMs))}
                    </p>
                    <p className="admin-cal-day-date">
                      {new Intl.DateTimeFormat("en-LK", { day: "2-digit", month: "short" }).format(new Date(day.dateMs))}
                    </p>
                  </div>
                  <div
                    className="admin-cal-day-body"
                    style={{ height: `${(viewEndHour - VIEW_START_HOUR) * 60 * PIXELS_PER_MINUTE}px` }}
                  >
                    {slotMinutes.map((m) => (
                      <button
                        key={`${day.key}-${m}`}
                        type="button"
                        className="admin-cal-slot"
                        style={{ top: `${(m - VIEW_START_HOUR * 60) * PIXELS_PER_MINUTE}px` }}
                        onClick={() => {
                          const hit = day.sessions.find((s) => {
                            const st = minutesFromDayStart(s.startAt);
                            let en = minutesFromDayStart(s.endAt);
                            if (en <= st) en += 24 * 60;
                            return m >= st && m < en;
                          });
                          setActiveSessionId(hit?.id ?? null);
                        }}
                        title="Click slot"
                      />
                    ))}
                    {(() => {
                      const slotGroups = new Map<string, Session[]>();
                      for (const session of day.sessions) {
                        const key = `${session.startAt}-${session.endAt}`;
                        slotGroups.set(key, [...(slotGroups.get(key) ?? []), session]);
                      }

                      const layoutGroups = computeSlotGroupLayouts(
                        Array.from(slotGroups.entries()).map(([key, sessions]) => ({ key, sessions })),
                      );

                      return layoutGroups.map(({ key, sessions: slotSessions, startMinutes, endMinutes, lane, laneCount }) => {
                        const first = slotSessions[0]!;
                        const clampedStart = Math.max(startMinutes, VIEW_START_HOUR * 60);
                        const clampedEnd = Math.min(endMinutes, viewEndHour * 60);
                        if (clampedEnd <= clampedStart) return null;

                        const top = (clampedStart - VIEW_START_HOUR * 60) * PIXELS_PER_MINUTE;
                        const height = Math.max((clampedEnd - clampedStart) * PIXELS_PER_MINUTE, 16);
                        const laneGap = 4;
                        const totalGap = laneGap * Math.max(0, laneCount - 1);
                        const width = `calc((100% - ${totalGap}px) / ${Math.max(1, laneCount)})`;
                        const left = `calc(${lane} * ((100% - ${totalGap}px) / ${Math.max(1, laneCount)} + ${laneGap}px))`;
                        const allSameStatus = slotSessions.every((s) => s.status === first.status);
                        const blockStatus = allSameStatus ? first.status : "scheduled";
                        const displayNames = slotSessions
                          .map((s) => studentsById.get(s.studentId)?.fullName ?? s.studentId)
                          .join(", ");

                        return (
                          <button
                            key={key}
                            type="button"
                            className={`admin-cal-event-block ${eventStatusClass(blockStatus)} ${
                              slotSessions.some((s) => s.id === activeSessionId)
                                ? "admin-cal-event-active"
                                : ""
                            }`}
                            style={{
                              top: `${top}px`,
                              height: `${height}px`,
                              left,
                              width,
                            }}
                            onClick={() => setActiveSessionId(first.id)}
                            title={displayNames}
                          >
                            <span className="admin-cal-event-time">
                              {timeLabel(first.startAt)} - {timeLabel(first.endAt)}
                            </span>
                            <span className="admin-cal-event-student">{displayNames}</span>
                          </button>
                        );
                      });
                    })()}
                  </div>
                </div>
              ))}
              </div>
            </div>
          </section>
        </>
      )}

      {activeSession ? (
        <div className="admin-cal-modal-backdrop" onClick={() => setActiveSessionId(null)}>
          <div className="admin-cal-modal card p-4 md:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">
                  {studentsById.get(activeSession.studentId)?.fullName ?? activeSession.studentId}
                </div>
                <div className="text-xs text-[rgb(var(--muted))]">
                  {dayLabel(activeSession.startAt)} • {timeLabel(activeSession.startAt)} -{" "}
                  {timeLabel(activeSession.endAt)}
                </div>
                <div className="mt-2">
                  <span className={`status-pill ${eventStatusClass(activeSession.status)}`}>
                    {statusLabel(activeSession.status)}
                  </span>
                </div>
                <div className="mt-2 text-xs text-[rgb(var(--muted))]">
                  {new Intl.NumberFormat("en-LK", {
                    style: "currency",
                    currency: "LKR",
                    maximumFractionDigits: 2,
                  }).format((activeSession.chargeCents ?? 0) / 100)}
                </div>
              </div>
              <button className="btn btn-ghost text-xs" onClick={() => setActiveSessionId(null)}>
                Close
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {activeSession.startAt > Date.now() ? (
                <div className="input min-w-[150px] text-center text-xs">scheduled</div>
              ) : (
                <select
                  className="input min-w-[150px] text-xs"
                  value={activeSession.status === "scheduled" ? "attended" : activeSession.status}
                  onChange={(e) =>
                    void updateSessionStatus(activeSession, e.target.value as AttendanceStatus)
                  }
                >
                  <option value="attended">Attended</option>
                  <option value="tutor_cancel">Tutor cancel</option>
                  <option value="early_cancel">Early cancel</option>
                  <option value="late_cancel">Late cancel</option>
                  <option value="no_show">No show</option>
                </select>
              )}
              <button className="btn btn-ghost text-xs" onClick={() => openEditTime(activeSession)}>
                Edit time
              </button>
              <button className="btn btn-ghost text-xs" onClick={() => void deleteSession(activeSession.id)}>
                Delete session
              </button>
              {activeSession.slotId ? (
                <button
                  className="btn btn-ghost text-xs"
                  onClick={() => void deleteLinkedSlot(String(activeSession.slotId))}
                >
                  Delete slot
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {editingSessionId ? (
        <div className="admin-cal-modal-backdrop" onClick={() => setEditingSessionId(null)}>
          <div className="admin-cal-modal card p-4 md:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold">Edit session time</div>
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
              <button
                className="btn btn-primary"
                onClick={() => void saveEditTime()}
                disabled={editSavingId === editingSessionId}
              >
                {editSavingId === editingSessionId ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

