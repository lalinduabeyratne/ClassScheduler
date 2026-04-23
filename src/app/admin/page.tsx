"use client";

import { signOut } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebase/client";
import { useAuthUser } from "@/lib/firebase/useAuthUser";
import { getUserRole } from "@/lib/roles/getUserRole";
import { qPendingPayments, qSessionsBetween } from "@/lib/firestore/api";
import { qPendingRescheduleRequests } from "@/lib/firestore/api";
import { useFirestoreQuery } from "@/lib/firestore/hooks";
import { computeChargeCents } from "@/lib/billing/fee";
import type { AttendanceStatus, Payment, Session } from "@/lib/model/types";
import { useStudentsMap } from "@/lib/students/useStudentsMap";

function startOfDayMs(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatTime(ms: number) {
  return new Intl.DateTimeFormat("en-LK", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

function formatMoneyLKR(cents: number) {
  const amount = (cents ?? 0) / 100;
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 2,
  }).format(amount);
}

export default function AdminPage() {
  const router = useRouter();
  const { user, loading } = useAuthUser();
  const [checkingRole, setCheckingRole] = useState(true);

  const now = new Date();
  const todayStart = startOfDayMs(now);
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const nextMonthStart = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    1,
  ).getTime();

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

  const todaySessionsQuery = useMemo(
    () =>
      ready ? qSessionsBetween({ startAtMs: todayStart, endAtMs: todayEnd }) : null,
    [ready, todayEnd, todayStart],
  );
  const monthSessionsQuery = useMemo(
    () =>
      ready
        ? qSessionsBetween({ startAtMs: monthStart, endAtMs: nextMonthStart })
        : null,
    [monthStart, nextMonthStart, ready],
  );
  const pendingPaymentsQuery = useMemo(() => (ready ? qPendingPayments() : null), [
    ready,
  ]);
  const pendingReschedulesQuery = useMemo(
    () => (ready ? qPendingRescheduleRequests() : null),
    [ready],
  );

  const { data: todaySessions, loading: todayLoading } =
    useFirestoreQuery<Session>(todaySessionsQuery);
  const { data: monthSessions } = useFirestoreQuery<Session>(monthSessionsQuery);
  const { data: pendingPayments, loading: pendingLoading } =
    useFirestoreQuery<Payment>(pendingPaymentsQuery);
  const { data: pendingReschedules } = useFirestoreQuery<Record<string, unknown>>(
    pendingReschedulesQuery,
  );
  const { byId: studentsById } = useStudentsMap(ready);

  const monthEarningsCents = useMemo(
    () => monthSessions.reduce((sum, s) => sum + (s.chargeCents ?? 0), 0),
    [monthSessions],
  );

  const lateCancelsToday = useMemo(
    () => todaySessions.filter((s) => s.status === "late_cancel").length,
    [todaySessions],
  );

  if (loading || checkingRole) {
    return <div className="text-sm text-[rgb(var(--muted))]">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Admin dashboard</div>
            <div className="mt-1 text-sm text-[rgb(var(--muted))]">
              Today’s classes, outstanding payments, late cancellations, monthly
              earnings.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a className="btn btn-ghost" href="/admin/timetable">
              Timetable
            </a>
            <a className="btn btn-ghost" href="/admin/calendar">
              Calendar
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

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card p-6">
          <div className="font-semibold">Today’s classes</div>
          <div className="mt-2 text-sm text-[rgb(var(--muted))]">
            {todayLoading ? "Loading…" : `${todaySessions.length} sessions`}
          </div>
        </div>
        <div className="card p-6">
          <div className="font-semibold">Outstanding payments</div>
          <div className="mt-2 text-sm text-[rgb(var(--muted))]">
            {pendingLoading ? "Loading…" : `${pendingPayments.length} pending slips`}
          </div>
        </div>
        <div className="card p-6">
          <div className="font-semibold">Monthly earnings</div>
          <div className="mt-2 text-sm text-[rgb(var(--muted))]">
            {formatMoneyLKR(monthEarningsCents)}
            <span className="ml-2 text-xs">({lateCancelsToday} late cancels today)</span>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="font-semibold">Today’s sessions</div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[rgb(var(--muted))]">
              <tr className="border-b border-[rgb(var(--border))]">
                <th className="py-2 pr-3">Time</th>
                <th className="py-2 pr-3">Student</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3 text-right">Charge</th>
              </tr>
            </thead>
            <tbody>
              {todaySessions.map((s) => (
                <tr key={s.id} className="border-b border-[rgb(var(--border))]">
                  <td className="py-2 pr-3">{formatTime(s.startAt)}</td>
                  <td className="py-2 pr-3">
                    <div className="font-medium">
                      {studentsById.get(s.studentId)?.fullName ?? s.studentId}
                    </div>
                    <div className="text-xs text-[rgb(var(--muted))] font-mono">
                      {s.studentId}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      className="input max-w-[220px]"
                      value={s.status}
                      onChange={async (e) => {
                        const status = e.target.value as AttendanceStatus;
                        const chargeCents = computeChargeCents({
                          feePerSessionCents: s.feePerSessionCents,
                          status,
                        });
                        await updateDoc(doc(db, "sessions", s.id), {
                          status,
                          chargeCents,
                          statusUpdatedAt: Date.now(),
                        });
                      }}
                    >
                      <option value="attended">Attended</option>
                      <option value="early_cancel">Early Cancel</option>
                      <option value="late_cancel">Late Cancel</option>
                      <option value="no_show">No Show</option>
                    </select>
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold">
                    {formatMoneyLKR(s.chargeCents)}
                  </td>
                </tr>
              ))}
              {todaySessions.length === 0 ? (
                <tr>
                  <td
                    className="py-6 text-center text-sm text-[rgb(var(--muted))]"
                    colSpan={4}
                  >
                    No sessions found for today (yet).
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-6">
        <div className="font-semibold">Pending payment slips</div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[rgb(var(--muted))]">
              <tr className="border-b border-[rgb(var(--border))]">
                <th className="py-2 pr-3">Student</th>
                <th className="py-2 pr-3 text-right">Amount</th>
                <th className="py-2 pr-3">Slip</th>
                <th className="py-2 pr-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingPayments.map((p) => (
                <tr key={p.id} className="border-b border-[rgb(var(--border))]">
                  <td className="py-2 pr-3">
                    <div className="font-medium">
                      {studentsById.get(p.studentId)?.fullName ?? p.studentId}
                    </div>
                    <div className="text-xs text-[rgb(var(--muted))] font-mono">
                      {p.studentId}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold">
                    {formatMoneyLKR(p.amountCents)}
                  </td>
                  <td className="py-2 pr-3">
                    {p.slipUrl ? (
                      <a className="text-[rgb(var(--brand))] hover:underline" href={p.slipUrl} target="_blank" rel="noreferrer">
                        View
                      </a>
                    ) : (
                      <span className="text-[rgb(var(--muted))]">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        className="btn btn-primary"
                        onClick={async () => {
                          await updateDoc(doc(db, "payments", p.id), {
                            status: "verified",
                          });
                        }}
                      >
                        Verify
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={async () => {
                          await updateDoc(doc(db, "payments", p.id), {
                            status: "rejected",
                          });
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {pendingPayments.length === 0 ? (
                <tr>
                  <td
                    className="py-6 text-center text-sm text-[rgb(var(--muted))]"
                    colSpan={4}
                  >
                    No pending payments.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-6">
        <div className="font-semibold">Reschedule requests</div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[rgb(var(--muted))]">
              <tr className="border-b border-[rgb(var(--border))]">
                <th className="py-2 pr-3">Student</th>
                <th className="py-2 pr-3">From session</th>
                <th className="py-2 pr-3">Requested</th>
                <th className="py-2 pr-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingReschedules.map((r: any) => (
                <tr key={r.id} className="border-b border-[rgb(var(--border))]">
                  <td className="py-2 pr-3">
                    <div className="font-medium">
                      {studentsById.get(String(r.studentId ?? ""))?.fullName ??
                        String(r.studentId ?? "")}
                    </div>
                    <div className="text-xs text-[rgb(var(--muted))] font-mono">
                      {String(r.studentId ?? "")}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="font-mono text-xs text-[rgb(var(--muted))]">
                      {String(r.fromSessionId ?? "")}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    {r.requestedStartAt ? new Date(Number(r.requestedStartAt)).toLocaleString() : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        className="btn btn-primary"
                        onClick={async () => {
                          const reqId = String(r.id);
                          const fromSessionId = String(r.fromSessionId);
                          const requestedStartAt = Number(r.requestedStartAt);
                          const requestedEndAt = Number(r.requestedEndAt);
                          await updateDoc(doc(db, "sessions", fromSessionId), {
                            startAt: requestedStartAt,
                            endAt: requestedEndAt,
                            createdFrom: "reschedule",
                          });
                          await updateDoc(doc(db, "rescheduleRequests", reqId), {
                            status: "approved",
                            updatedAt: Date.now(),
                          });
                        }}
                      >
                        Approve
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={async () => {
                          const reqId = String(r.id);
                          await updateDoc(doc(db, "rescheduleRequests", reqId), {
                            status: "rejected",
                            updatedAt: Date.now(),
                          });
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {pendingReschedules.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-[rgb(var(--muted))]">
                    No reschedule requests.
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

