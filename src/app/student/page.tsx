"use client";

import { collection, limit, query, where } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase/client";
import { useAuthUser } from "@/lib/firebase/useAuthUser";
import { getUserRole } from "@/lib/roles/getUserRole";
import {
  getStudentById,
  getUserDoc,
  qPaymentsForStudent,
  qSessionsForStudent,
} from "@/lib/firestore/api";
import { useFirestoreQuery } from "@/lib/firestore/hooks";
import { col } from "@/lib/firestore/paths";
import { computeStudentBalance } from "@/lib/billing/rollup";
import type { Payment, Session, Student } from "@/lib/model/types";
import { createPaymentWithSlip } from "@/lib/payments/createPaymentWithSlip";
import { createRescheduleRequest } from "@/lib/reschedule/createRequest";
import { StudentTopNav } from "@/app/student/_components/StudentTopNav";

function formatMoneyLKR(cents: number) {
  const amount = (cents ?? 0) / 100;
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDateTimeCompact(ms: number) {
  return new Intl.DateTimeFormat("en-LK", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ms));
}

export default function StudentPage() {
  const router = useRouter();
  const { user, loading } = useAuthUser();
  const [checkingRole, setCheckingRole] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [studentProfile, setStudentProfile] = useState<Student | null>(null);
  const [payAmountLkr, setPayAmountLkr] = useState("");
  const [payFile, setPayFile] = useState<File | null>(null);
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [paySuccess, setPaySuccess] = useState<string | null>(null);
  const [rescheduleSessionId, setRescheduleSessionId] = useState("");
  const [rescheduleNewStart, setRescheduleNewStart] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [rescheduleSubmitting, setRescheduleSubmitting] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [rescheduleSuccess, setRescheduleSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const draftAmount = window.localStorage.getItem("student.pay.amountLkr");
    const draftReason = window.localStorage.getItem("student.reschedule.reason");
    const draftNewStart = window.localStorage.getItem("student.reschedule.newStart");
    if (draftAmount) setPayAmountLkr(draftAmount);
    if (draftReason) setRescheduleReason(draftReason);
    if (draftNewStart) setRescheduleNewStart(draftNewStart);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("student.pay.amountLkr", payAmountLkr);
  }, [payAmountLkr]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("student.reschedule.reason", rescheduleReason);
  }, [rescheduleReason]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("student.reschedule.newStart", rescheduleNewStart);
  }, [rescheduleNewStart]);

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
        const linkedStudentId = u?.studentId ?? null;
        setStudentId(linkedStudentId);
        if (linkedStudentId) {
          const profile = await getStudentById(linkedStudentId);
          setStudentProfile(profile);
        } else {
          setStudentProfile(null);
        }
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
    () => (studentId ? qSessionsForStudent(studentId) : null),
    [studentId],
  );
  const paymentsQuery = useMemo(
    () => (studentId ? qPaymentsForStudent(studentId) : null),
    [studentId],
  );
  const reschedulesQuery = useMemo(
    () =>
      studentId
        ? query(
            collection(db, col.rescheduleRequests()),
            where("studentId", "==", studentId),
            limit(200),
          )
        : null,
    [studentId],
  );

  const { data: sessions, loading: sessionsLoading, error: sessionsError } = useFirestoreQuery<Session>(
    sessionsQuery,
  );
  const { data: payments, loading: paymentsLoading, error: paymentsError } = useFirestoreQuery<Payment>(
    paymentsQuery,
  );
  const { data: reschedules, error: reschedulesError } = useFirestoreQuery<Record<string, unknown>>(reschedulesQuery);

  const balance = useMemo(
    () => computeStudentBalance({ sessions, payments }),
    [payments, sessions],
  );
  const duePaymentCents = Math.max(0, balance.remainingCents);

  const upcomingSessions = useMemo(() => {
    const nowMs = Date.now();
    return sessions
      .filter((s) => (s.startAt ?? 0) > nowMs)
      .sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0))
      .slice(0, 10);
  }, [sessions]);

  const paymentHistory = useMemo(() => {
    return [...payments].sort((a, b) => b.paidAt - a.paidAt).slice(0, 30);
  }, [payments]);

  const unpaidSessions = useMemo(() => {
    return [...sessions]
      .filter((session) => Number(session.chargeCents ?? 0) > 0)
      .sort((a, b) => (b.startAt ?? 0) - (a.startAt ?? 0))
      .slice(0, 12);
  }, [sessions]);

  const sortedReschedules = useMemo(() => {
    return [...reschedules].sort(
      (a, b) => Number((b as any).createdAt ?? 0) - Number((a as any).createdAt ?? 0),
    );
  }, [reschedules]);

  const payAmountCents = Math.round(Number(payAmountLkr) * 100);
  const payAmountError =
    payAmountLkr.trim().length === 0
      ? "Enter an amount in LKR."
      : !Number.isFinite(payAmountCents) || payAmountCents <= 0
        ? "Amount must be greater than 0."
        : null;
  const canSubmitPayment = Boolean(studentId && payFile && !payAmountError && !paySubmitting);

  const selectedRescheduleSession = useMemo(
    () => upcomingSessions.find((s) => s.id === rescheduleSessionId) ?? null,
    [rescheduleSessionId, upcomingSessions],
  );
  const requestedStartAtMs = rescheduleNewStart ? new Date(rescheduleNewStart).getTime() : NaN;
  const rescheduleTimeError =
    !rescheduleNewStart
      ? "Pick a new date and time."
      : !Number.isFinite(requestedStartAtMs) || requestedStartAtMs <= Date.now()
        ? "New time must be in the future."
        : null;
  const canSubmitReschedule = Boolean(
    studentId && selectedRescheduleSession && !rescheduleTimeError && !rescheduleSubmitting,
  );

  if (loading || checkingRole) {
    return <div className="text-sm text-[rgb(var(--muted))]">Loading...</div>;
  }

  if (accessError) {
    return <div className="text-sm text-red-300">{accessError}</div>;
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:px-6 md:py-8">
      <div id="payment-upload">
        <StudentTopNav />
      </div>

      {sessionsError || paymentsError || reschedulesError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200" aria-live="polite">
          Data sync issue: {[sessionsError, paymentsError, reschedulesError].filter(Boolean).join(" | ")}
        </div>
      ) : null}

      <div className="card border-emerald-400/30 bg-gradient-to-br from-emerald-500/10 via-[rgb(var(--card))] to-transparent p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-[rgb(var(--muted))]">Due payment</div>
            <div className="mt-1 text-3xl font-semibold">
              {sessionsLoading || paymentsLoading ? "…" : formatMoneyLKR(duePaymentCents)}
            </div>
            <div className="mt-2 text-sm text-[rgb(var(--muted))]">
              {duePaymentCents > 0
                ? "This is the amount still due based on verified payments and attendance charges."
                : "No payment is due right now."}
            </div>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="font-semibold">My profile</div>
        {!studentId ? (
          <div className="mt-2 text-sm text-[rgb(var(--muted))]">
            Link your account to a student record first.
          </div>
        ) : !studentProfile ? (
          <div className="mt-2 text-sm text-[rgb(var(--muted))]">Student profile not found.</div>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-[rgb(var(--border))] p-3">
              <div className="text-xs text-[rgb(var(--muted))]">Full name</div>
              <div className="font-medium">{studentProfile.fullName}</div>
            </div>
            <div className="rounded-lg border border-[rgb(var(--border))] p-3">
              <div className="text-xs text-[rgb(var(--muted))]">Email</div>
              <div className="font-medium">{studentProfile.email || "-"}</div>
            </div>
            <div className="rounded-lg border border-[rgb(var(--border))] p-3">
              <div className="text-xs text-[rgb(var(--muted))]">Parent name</div>
              <div className="font-medium">{studentProfile.parentName || "-"}</div>
            </div>
            <div className="rounded-lg border border-[rgb(var(--border))] p-3">
              <div className="text-xs text-[rgb(var(--muted))]">Contact number</div>
              <div className="font-medium">{studentProfile.contactNumber || "-"}</div>
            </div>
          </div>
        )}
      </div>

      <div className="card p-6">
        <div className="font-semibold">Unpaid sessions</div>
        <div className="mt-1 text-xs text-[rgb(var(--muted))]">
          Sessions with a charge amount. Payments are tracked against your total balance.
        </div>
        {!studentId ? (
          <div className="mt-2 text-sm text-[rgb(var(--muted))]">
            Link your account to a student record first.
          </div>
        ) : unpaidSessions.length === 0 ? (
          <div className="mt-3 text-sm text-[rgb(var(--muted))]">No charged sessions found.</div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[rgb(var(--muted))]">
                <tr className="border-b border-[rgb(var(--border))]">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Charge</th>
                </tr>
              </thead>
              <tbody>
                {unpaidSessions.map((s) => (
                  <tr key={s.id} className="border-b border-[rgb(var(--border))]">
                    <td className="py-2 pr-3">{formatDateTimeCompact(s.startAt)}</td>
                    <td className="py-2 pr-3">{s.status.replaceAll("_", " ")}</td>
                    <td className="py-2 pr-3 text-right">{formatMoneyLKR(s.chargeCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
                  {upcomingSessions.slice(0, 3).map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3">
                      <div className="font-medium">
                        {formatDateTimeCompact(s.startAt)}
                      </div>
                      <div className="text-xs text-[rgb(var(--muted))]">
                        {s.status.replaceAll("_", " ")}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
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
            aria-busy={paySubmitting}
            onSubmit={async (e) => {
              e.preventDefault();
              setPayError(null);
              setPaySuccess(null);
              if (!studentId) return;
              if (!payFile) {
                setPayError("Please choose an image/PDF slip.");
                return;
              }
              if (payAmountError) {
                setPayError(payAmountError);
                return;
              }
              setPaySubmitting(true);
              try {
                await createPaymentWithSlip({
                  studentId,
                  amountCents: payAmountCents,
                  file: payFile,
                });
                setPayAmountLkr("");
                setPayFile(null);
                setPaySuccess("Payment submitted successfully. It will stay pending until verified.");
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
              <div className={`text-xs ${payAmountError ? "text-rose-300" : "text-[rgb(var(--muted))]"}`}>
                {payAmountError ? payAmountError : `You are about to submit ${formatMoneyLKR(payAmountCents)}.`}
              </div>
            </div>
            <div className="space-y-1 md:col-span-2">
              <div className="label">Slip (image or PDF)</div>
              <input
                className="input"
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setPayFile(e.target.files?.[0] ?? null)}
              />
              <div className="text-xs text-[rgb(var(--muted))]">
                {payFile ? `Selected file: ${payFile.name}` : "Choose an image or PDF receipt."}
              </div>
            </div>

            {payError ? (
              <div className="md:col-span-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200" aria-live="polite">
                {payError}
              </div>
            ) : null}

            {paySuccess ? (
              <div className="md:col-span-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200" aria-live="polite">
                {paySuccess}
              </div>
            ) : null}

            <div className="md:col-span-3 flex items-center justify-end">
              <button className="btn btn-primary" disabled={!canSubmitPayment}>
                {paySubmitting ? "Uploading..." : "Submit payment"}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="card p-6" id="payment-history">
        <div className="font-semibold">My payment history</div>
        {!studentId ? (
          <div className="mt-2 text-sm text-[rgb(var(--muted))]">
            Link your account to a student record first.
          </div>
        ) : (
          <div className="mt-3">
            {paymentHistory.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[rgb(var(--border))] p-4 text-sm text-[rgb(var(--muted))]">
                No payment records yet.
              </div>
            ) : null}

            <div className="space-y-2 md:hidden">
              {paymentHistory.map((p) => (
                <div key={p.id} className="rounded-lg border border-[rgb(var(--border))] p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{new Date(p.paidAt).toLocaleDateString()}</div>
                    <div className="font-semibold">{formatMoneyLKR(p.amountCents)}</div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[rgb(var(--muted))]">
                    <div>Type: {(p.paymentType ?? "single").replaceAll("_", " ")}</div>
                    <div>Method: {p.method ?? "online"}</div>
                    <div className="col-span-2">Coverage: {p.coverageNote ?? "-"}</div>
                    <div className="col-span-2">Status: {p.status.replaceAll("_", " ")}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="text-left text-[rgb(var(--muted))]">
                  <tr className="border-b border-[rgb(var(--border))]">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Coverage</th>
                    <th className="py-2 pr-3">Method</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentHistory.map((p) => (
                    <tr key={p.id} className="border-b border-[rgb(var(--border))]">
                      <td className="py-2 pr-3">{new Date(p.paidAt).toLocaleDateString()}</td>
                      <td className="py-2 pr-3">{(p.paymentType ?? "single").replaceAll("_", " ")}</td>
                      <td className="py-2 pr-3">{p.coverageNote ?? "-"}</td>
                      <td className="py-2 pr-3">{p.method ?? "online"}</td>
                      <td className="py-2 pr-3">{p.status.replaceAll("_", " ")}</td>
                      <td className="py-2 pr-3 text-right">{formatMoneyLKR(p.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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
            aria-busy={rescheduleSubmitting}
            onSubmit={async (e) => {
              e.preventDefault();
              setRescheduleError(null);
              setRescheduleSuccess(null);
              if (!studentId) return;
              const session = selectedRescheduleSession;
              if (!session) {
                setRescheduleError("Choose the session you want to reschedule.");
                return;
              }
              if (rescheduleTimeError) {
                setRescheduleError(rescheduleTimeError);
                return;
              }
              const durationMs = Math.max(0, (session.endAt ?? 0) - (session.startAt ?? 0));
              const requestedEndAt = requestedStartAtMs + durationMs;

              setRescheduleSubmitting(true);
              try {
                await createRescheduleRequest({
                  studentId,
                  fromSessionId: session.id,
                  requestedStartAt: requestedStartAtMs,
                  requestedEndAt,
                  reason: rescheduleReason.trim(),
                });
                setRescheduleSessionId("");
                setRescheduleNewStart("");
                setRescheduleReason("");
                setRescheduleSuccess("Reschedule request submitted. The tutor will review it.");
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
                    {formatDateTimeCompact(s.startAt)} (current)
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
              <div className={`text-xs ${rescheduleTimeError ? "text-rose-300" : "text-[rgb(var(--muted))]"}`}>
                {rescheduleTimeError ?? "Choose a future date and time."}
              </div>
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
              <div className="md:col-span-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200" aria-live="polite">
                {rescheduleError}
              </div>
            ) : null}

            {rescheduleSuccess ? (
              <div className="md:col-span-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200" aria-live="polite">
                {rescheduleSuccess}
              </div>
            ) : null}

            <div className="md:col-span-3 flex items-center justify-end">
              <button className="btn btn-primary" disabled={!canSubmitReschedule}>
                {rescheduleSubmitting ? "Submitting..." : "Request reschedule"}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="card p-6">
        <div className="font-semibold">My reschedule requests</div>
        {!studentId ? (
          <div className="mt-2 text-sm text-[rgb(var(--muted))]">
            Link your account to a student record first.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[rgb(var(--muted))]">
                <tr className="border-b border-[rgb(var(--border))]">
                  <th className="py-2 pr-3">Requested at</th>
                  <th className="py-2 pr-3">Requested start</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedReschedules.map((r: any) => (
                  <tr key={String(r.id)} className="border-b border-[rgb(var(--border))]">
                    <td className="py-2 pr-3">
                      {r.createdAt ? new Date(Number(r.createdAt)).toLocaleString() : "-"}
                    </td>
                    <td className="py-2 pr-3">
                      {r.requestedStartAt
                        ? new Date(Number(r.requestedStartAt)).toLocaleString()
                        : "-"}
                    </td>
                    <td className="py-2 pr-3">{String(r.status ?? "requested")}</td>
                  </tr>
                ))}
                {sortedReschedules.length === 0 ? (
                  <tr>
                    <td className="py-4 text-[rgb(var(--muted))]" colSpan={3}>
                      No reschedule requests.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

