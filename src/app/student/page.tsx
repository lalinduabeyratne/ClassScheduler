"use client";

import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase/client";
import { useAuthUser } from "@/lib/firebase/useAuthUser";
import { getUserRole } from "@/lib/roles/getUserRole";
import { getUserDoc, qPaymentsForStudent, qSessionsForStudent } from "@/lib/firestore/api";
import { useFirestoreQuery } from "@/lib/firestore/hooks";
import { computeStudentBalance } from "@/lib/billing/rollup";
import type { Payment, Session } from "@/lib/model/types";
import { createPaymentWithSlip } from "@/lib/payments/createPaymentWithSlip";
import { createRescheduleRequest } from "@/lib/reschedule/createRequest";

function formatMoneyLKR(cents: number) {
  const amount = (cents ?? 0) / 100;
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 2,
  }).format(amount);
}

export default function StudentPage() {
  const router = useRouter();
  const { user, loading } = useAuthUser();
  const [checkingRole, setCheckingRole] = useState(true);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [payAmountLkr, setPayAmountLkr] = useState("");
  const [payFile, setPayFile] = useState<File | null>(null);
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [rescheduleSessionId, setRescheduleSessionId] = useState("");
  const [rescheduleNewStart, setRescheduleNewStart] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [rescheduleSubmitting, setRescheduleSubmitting] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    (async () => {
      const role = await getUserRole(user.uid);
      if (role !== "student") router.replace("/admin");
      const u = await getUserDoc(user.uid);
      setStudentId(u?.studentId ?? null);
      setCheckingRole(false);
    })();
  }, [loading, router, user]);

  const sessionsQuery = useMemo(
    () => (studentId ? qSessionsForStudent(studentId) : null),
    [studentId],
  );
  const paymentsQuery = useMemo(
    () => (studentId ? qPaymentsForStudent(studentId) : null),
    [studentId],
  );

  const { data: sessions, loading: sessionsLoading } = useFirestoreQuery<Session>(
    sessionsQuery,
  );
  const { data: payments, loading: paymentsLoading } = useFirestoreQuery<Payment>(
    paymentsQuery,
  );

  const balance = useMemo(
    () => computeStudentBalance({ sessions, payments }),
    [payments, sessions],
  );

  const upcomingSessions = useMemo(() => {
    const nowMs = Date.now();
    return sessions
      .filter((s) => (s.startAt ?? 0) > nowMs)
      .sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0))
      .slice(0, 10);
  }, [sessions]);

  if (loading || checkingRole) {
    return <div className="text-sm text-[rgb(var(--muted))]">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Student portal</div>
            <div className="mt-1 text-sm text-[rgb(var(--muted))]">
              View schedule, view fees, upload payment slips, request reschedule.
            </div>
          </div>
          <div className="flex items-center gap-2">
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

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-6">
          <div className="font-semibold">My schedule</div>
          {!studentId ? (
            <div className="mt-2 text-sm text-[rgb(var(--muted))]">
              Link your account to a student record first.
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {upcomingSessions.length === 0 ? (
                <div className="text-sm text-[rgb(var(--muted))]">
                  No upcoming sessions yet. Ask the tutor to generate sessions from the timetable.
                </div>
              ) : (
                <ul className="space-y-2 text-sm">
                  {upcomingSessions.slice(0, 5).map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3">
                      <div className="font-medium">
                        {new Date(s.startAt).toLocaleString()}
                      </div>
                      <div className="text-xs text-[rgb(var(--muted))]">
                        {s.status.replaceAll("_", " ")}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="pt-2">
                <a className="btn btn-ghost" href="/student/calendar">
                  Open calendar
                </a>
              </div>
            </div>
          )}
        </div>
        <div className="card p-6">
          <div className="font-semibold">My fees</div>
          {studentId ? (
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <div className="text-[rgb(var(--muted))]">Total to date</div>
                <div className="font-semibold">
                  {sessionsLoading ? "…" : formatMoneyLKR(balance.totalChargedCents)}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-[rgb(var(--muted))]">Paid (verified)</div>
                <div className="font-semibold">
                  {paymentsLoading ? "…" : formatMoneyLKR(balance.totalPaidCents)}
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-[rgb(var(--border))] pt-2">
                <div className="text-[rgb(var(--muted))]">Remaining balance</div>
                <div className="text-base font-semibold">
                  {sessionsLoading || paymentsLoading
                    ? "…"
                    : formatMoneyLKR(balance.remainingCents)}
                </div>
              </div>
              <div className="pt-2 text-xs text-[rgb(var(--muted))]">
                Charges come from attendance: attended = 100%, late cancel = 50%, no-show = 100%, early cancel = 0%.
              </div>
            </div>
          ) : (
            <div className="mt-2 text-sm text-[rgb(var(--muted))]">
              Your account is missing a linked student record. Ask the tutor/admin to set your <code className="font-mono">studentId</code>.
            </div>
          )}
        </div>
      </div>

      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">Upload a payment slip</div>
          <div className="text-xs text-[rgb(var(--muted))]">
            Payments are added as “pending” until the tutor verifies.
          </div>
        </div>

        {!studentId ? (
          <div className="mt-3 text-sm text-[rgb(var(--muted))]">
            Link your account to a student record first.
          </div>
        ) : (
          <form
            className="mt-4 grid gap-3 md:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setPayError(null);
              if (!studentId) return;
              if (!payFile) {
                setPayError("Please choose an image/PDF slip.");
                return;
              }
              const amount = Math.round(Number(payAmountLkr) * 100);
              if (!Number.isFinite(amount) || amount <= 0) {
                setPayError("Enter a valid amount in LKR.");
                return;
              }
              setPaySubmitting(true);
              try {
                await createPaymentWithSlip({
                  studentId,
                  amountCents: amount,
                  file: payFile,
                });
                setPayAmountLkr("");
                setPayFile(null);
              } catch (err) {
                setPayError(err instanceof Error ? err.message : "Upload failed");
              } finally {
                setPaySubmitting(false);
              }
            }}
          >
            <div className="space-y-1">
              <div className="label">Amount (LKR)</div>
              <input
                className="input"
                value={payAmountLkr}
                onChange={(e) => setPayAmountLkr(e.target.value)}
                placeholder="2500"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <div className="label">Slip (image or PDF)</div>
              <input
                className="input"
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setPayFile(e.target.files?.[0] ?? null)}
              />
            </div>

            {payError ? (
              <div className="md:col-span-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                {payError}
              </div>
            ) : null}

            <div className="md:col-span-3 flex items-center justify-end">
              <button className="btn btn-primary" disabled={paySubmitting}>
                {paySubmitting ? "Uploading..." : "Submit payment"}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">Request a reschedule</div>
          <div className="text-xs text-[rgb(var(--muted))]">
            The tutor must approve before it updates your schedule.
          </div>
        </div>

        {!studentId ? (
          <div className="mt-3 text-sm text-[rgb(var(--muted))]">
            Link your account to a student record first.
          </div>
        ) : (
          <form
            className="mt-4 grid gap-3 md:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setRescheduleError(null);
              if (!studentId) return;
              const session = upcomingSessions.find((s) => s.id === rescheduleSessionId);
              if (!session) {
                setRescheduleError("Choose the session you want to reschedule.");
                return;
              }
              if (!rescheduleNewStart) {
                setRescheduleError("Choose a new date/time.");
                return;
              }
              const requestedStartAt = new Date(rescheduleNewStart).getTime();
              if (!Number.isFinite(requestedStartAt) || requestedStartAt <= Date.now()) {
                setRescheduleError("New time must be in the future.");
                return;
              }
              const durationMs = Math.max(0, (session.endAt ?? 0) - (session.startAt ?? 0));
              const requestedEndAt = requestedStartAt + durationMs;

              setRescheduleSubmitting(true);
              try {
                await createRescheduleRequest({
                  studentId,
                  fromSessionId: session.id,
                  requestedStartAt,
                  requestedEndAt,
                  reason: rescheduleReason.trim(),
                });
                setRescheduleSessionId("");
                setRescheduleNewStart("");
                setRescheduleReason("");
              } catch (err) {
                setRescheduleError(
                  err instanceof Error ? err.message : "Request failed",
                );
              } finally {
                setRescheduleSubmitting(false);
              }
            }}
          >
            <div className="space-y-1 md:col-span-3">
              <div className="label">Session to reschedule</div>
              <select
                className="input"
                value={rescheduleSessionId}
                onChange={(e) => setRescheduleSessionId(e.target.value)}
              >
                <option value="">Select…</option>
                {upcomingSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {new Date(s.startAt).toLocaleString()} (current)
                  </option>
                ))}
              </select>
              {upcomingSessions.length === 0 ? (
                <div className="pt-1 text-xs text-[rgb(var(--muted))]">
                  No upcoming sessions found yet. (The tutor generates sessions from the weekly timetable.)
                </div>
              ) : null}
            </div>

            <div className="space-y-1">
              <div className="label">New date & time</div>
              <input
                className="input"
                type="datetime-local"
                value={rescheduleNewStart}
                onChange={(e) => setRescheduleNewStart(e.target.value)}
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <div className="label">Reason (optional)</div>
              <input
                className="input"
                value={rescheduleReason}
                onChange={(e) => setRescheduleReason(e.target.value)}
                placeholder="e.g. school event"
              />
            </div>

            {rescheduleError ? (
              <div className="md:col-span-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                {rescheduleError}
              </div>
            ) : null}

            <div className="md:col-span-3 flex items-center justify-end">
              <button className="btn btn-primary" disabled={rescheduleSubmitting}>
                {rescheduleSubmitting ? "Submitting..." : "Request reschedule"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

