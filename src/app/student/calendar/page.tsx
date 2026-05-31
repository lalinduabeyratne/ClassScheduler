"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuthUser } from "@/lib/firebase/useAuthUser";
import { getUserRole } from "@/lib/roles/getUserRole";
import { getUserDoc, qSessionsForStudent, qPaymentsForStudent } from "@/lib/firestore/api";
import { useFirestoreQuery } from "@/lib/firestore/hooks";
import type { Session, Payment } from "@/lib/model/types";
import { allocateVerifiedPaymentsOldestFirst } from "@/lib/billing/rollup";
import { StudentTopNav } from "@/app/student/_components/StudentTopNav";

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

export default function StudentCalendarPage() {
  const router = useRouter();
  const { user, loading } = useAuthUser();
  const [checkingRole, setCheckingRole] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [studentId, setStudentId] = useState<string | null>(null);

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

  const sessionsQuery = useMemo(
    () => (studentId && !accessError ? qSessionsForStudent(studentId) : null),
    [accessError, studentId],
  );
  const paymentsQuery = useMemo(
    () => (studentId && !accessError ? qPaymentsForStudent(studentId) : null),
    [accessError, studentId],
  );
  const { data: sessions } = useFirestoreQuery<Session>(sessionsQuery);
  const visibleSessions = useMemo(() => sessions.filter((session) => !session.deletedAt), [sessions]);
  const { data: payments } = useFirestoreQuery<Payment>(paymentsQuery);

  // Calculate prepaid coverage for all upcoming sessions
  const sessionsPrepaidCoverage = useMemo(() => {
    const paymentCoverage = allocateVerifiedPaymentsOldestFirst({ sessions: visibleSessions, payments });
    const nowMs = Date.now();
    const upcomingScheduled = visibleSessions
      .filter((s) => (s.startAt ?? 0) > nowMs && s.status === "scheduled" && Math.max(0, Number(s.feePerSessionCents ?? 0)) > 0)
      .sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0));

    let remainingCredit = paymentCoverage.remainingCreditCents;
    const coveredIds = new Set<string>(paymentCoverage.fullyPaidSessionIds);

    for (const session of upcomingScheduled) {
      if (coveredIds.has(session.id)) continue;
      const chargeCents = Math.max(0, Number(session.feePerSessionCents ?? 0));
      if (remainingCredit >= chargeCents) {
        coveredIds.add(session.id);
        remainingCredit -= chargeCents;
      }
    }

    return coveredIds;
  }, [payments, visibleSessions]);

  const next7Days = useMemo(() => {
    const start = new Date();
    const startMs = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate(),
    ).getTime();
    const endMs = startMs + 7 * 24 * 60 * 60 * 1000;
    return visibleSessions
      .filter((s) => s.startAt >= startMs && s.startAt < endMs)
      .sort((a, b) => a.startAt - b.startAt);
  }, [visibleSessions]);

  const grouped = useMemo(() => {
    const m = new Map<string, Session[]>();
    for (const s of next7Days) {
      const key = new Date(s.startAt).toDateString();
      m.set(key, [...(m.get(key) ?? []), s]);
    }
    return m;
  }, [next7Days]);

  if (loading || checkingRole) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-7xl items-center justify-center px-4 py-6 md:px-6 md:py-8">
        <div className="card w-full max-w-md p-6 text-center">
          <div className="text-lg font-semibold">Loading calendar</div>
          <div className="mt-2 text-sm text-[rgb(var(--muted))]">
            Fetching your sessions and timetable.
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
      <StudentTopNav />

      <div className="card p-6">
        <div className="text-lg font-semibold">My calendar (next 7 days)</div>
        <div className="mt-1 text-sm text-[rgb(var(--muted))]">
          Upcoming sessions generated from the weekly timetable (and any approved reschedules).
        </div>
      </div>

      {!studentId ? (
        <div className="card p-6 text-sm text-[rgb(var(--muted))]">
          Your account is missing a linked student record.
        </div>
      ) : grouped.size === 0 ? (
        <div className="card p-6 text-sm text-[rgb(var(--muted))]">
          No sessions in the next 7 days.
        </div>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {Array.from(grouped.entries()).map(([key, daySessions]) => (
              <div key={key} className="card p-4">
                <div className="font-semibold">{dayLabel(daySessions[0]!.startAt)}</div>
                <ul className="mt-3 space-y-2 text-sm">
                  {daySessions.map((s) => {
                    const isPrepaid = sessionsPrepaidCoverage.has(s.id);
                    return (
                      <li key={s.id} className={`rounded-lg border p-3 ${isPrepaid ? "border-emerald-500/50 bg-emerald-500/10" : "border-[rgb(var(--border))]"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="text-xs text-[rgb(var(--muted))]">
                              {timeLabel(s.startAt)} - {timeLabel(s.endAt)}
                            </div>
                            <div className="mt-1 font-medium">Session</div>
                            <div className="mt-1 text-xs text-[rgb(var(--muted))]">
                              {s.status.replaceAll("_", " ")}
                            </div>
                          </div>
                          {isPrepaid && (
                            <span className="shrink-0 rounded-full bg-emerald-500/30 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-100">
                              Prepaid
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="hidden gap-4 md:grid md:grid-cols-2">
            {Array.from(grouped.entries()).map(([key, daySessions]) => (
              <div key={key} className="card p-6">
                <div className="font-semibold">{dayLabel(daySessions[0]!.startAt)}</div>
                <ul className="mt-3 space-y-2 text-sm">
                  {daySessions.map((s) => {
                    const isPrepaid = sessionsPrepaidCoverage.has(s.id);
                    return (
                      <li key={s.id} className="flex items-center justify-between">
                        <div className="font-medium">
                          {timeLabel(s.startAt)} - {timeLabel(s.endAt)}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-xs text-[rgb(var(--muted))]">
                            {s.status.replaceAll("_", " ")}
                          </div>
                          {isPrepaid && (
                            <span className="rounded-full bg-emerald-500/30 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-100">
                              Prepaid
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

