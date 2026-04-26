"use client";

import { addDoc, arrayUnion, collection, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { FirebaseError } from "firebase/app";
import { getDownloadURL, ref } from "firebase/storage";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AdminTopNav } from "@/app/admin/_components/AdminTopNav";
import { computeMonthlySummary, getMonthlyReportRows, monthKeyFromMs } from "@/lib/billing/monthly";
import { computeChargeCents } from "@/lib/billing/fee";
import { exportStudentMonthlyPdf } from "@/lib/billing/exportPdf";
import { db, storage } from "@/lib/firebase/client";
import { useAuthUser } from "@/lib/firebase/useAuthUser";
import {
  qPendingPayments,
  qPendingRescheduleRequests,
  qPaymentsBetween,
  qSessionsBetween,
  qStudents,
} from "@/lib/firestore/api";
import { useFirestoreQuery } from "@/lib/firestore/hooks";
import { col } from "@/lib/firestore/paths";
import type { AttendanceStatus, Payment, PaymentMethod, PaymentType, Session } from "@/lib/model/types";
import { getUserRole } from "@/lib/roles/getUserRole";

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

function extractStoragePathFromSlipUrl(slipUrl: string): string | null {
  try {
    const parsed = new URL(slipUrl);
    const byNameQuery = parsed.searchParams.get("name");
    if (byNameQuery) return decodeURIComponent(byNameQuery);

    const marker = "/o/";
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex >= 0) {
      const encodedPath = parsed.pathname.slice(markerIndex + marker.length);
      if (encodedPath) return decodeURIComponent(encodedPath);
    }
    return null;
  } catch {
    return null;
  }
}

function statusButtonClass(active: boolean, kind: "attended" | "tutor_cancel" | "early_cancel" | "late_cancel" | "no_show") {
  if (kind === "attended") {
    return active
      ? "bg-emerald-600 text-white border-emerald-600"
      : "border-emerald-400 text-emerald-700 dark:text-emerald-300";
  }
  if (kind === "tutor_cancel") {
    return active
      ? "bg-indigo-600 text-white border-indigo-600"
      : "border-indigo-400 text-indigo-700 dark:text-indigo-300";
  }
  if (kind === "early_cancel") {
    return active
      ? "bg-sky-600 text-white border-sky-600"
      : "border-sky-400 text-sky-700 dark:text-sky-300";
  }
  if (kind === "late_cancel") {
    return active
      ? "bg-amber-500 text-black border-amber-500"
      : "border-amber-400 text-amber-700 dark:text-amber-300";
  }
  return active ? "bg-rose-600 text-white border-rose-600" : "border-rose-400 text-rose-700 dark:text-rose-300";
}

function statusLabel(status: AttendanceStatus) {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export default function AdminPage() {
  const router = useRouter();
  const { user, loading } = useAuthUser();
  const [checkingRole, setCheckingRole] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [slipActionError, setSlipActionError] = useState<string | null>(null);

  const now = new Date();
  const todayStart = startOfDayMs(now);
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  const allStartMs = new Date(2020, 0, 1).getTime();
  const allEndMs = new Date(2035, 0, 1).getTime();

  const [selectedMonth, setSelectedMonth] = useState(monthKeyFromMs(Date.now()));
  const [selectedStudentForReport, setSelectedStudentForReport] = useState("");

  const [paymentStudentId, setPaymentStudentId] = useState("");
  const [paymentAmountLkr, setPaymentAmountLkr] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentType, setPaymentType] = useState<PaymentType>("single");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentCoverageNote, setPaymentCoverageNote] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [openingSlipPaymentId, setOpeningSlipPaymentId] = useState<string | null>(null);
  const [showAllOutstanding, setShowAllOutstanding] = useState(false);
  const [showAllFeeSetup, setShowAllFeeSetup] = useState(false);
  const [showAllTotals, setShowAllTotals] = useState(false);
  const [showAllMonthlySummary, setShowAllMonthlySummary] = useState(false);

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

  const todaySessionsQuery = useMemo(
    () => (ready ? qSessionsBetween({ startAtMs: todayStart, endAtMs: todayEnd }) : null),
    [ready, todayEnd, todayStart],
  );
  const monthSessionsQuery = useMemo(
    () =>
      ready
        ? qSessionsBetween({ startAtMs: monthStart, endAtMs: nextMonthStart })
        : null,
    [monthStart, nextMonthStart, ready],
  );
  const allSessionsQuery = useMemo(
    () => (ready ? qSessionsBetween({ startAtMs: allStartMs, endAtMs: allEndMs }) : null),
    [allEndMs, allStartMs, ready],
  );
  const allPaymentsQuery = useMemo(
    () => (ready ? qPaymentsBetween({ startAtMs: allStartMs, endAtMs: allEndMs }) : null),
    [allEndMs, allStartMs, ready],
  );
  const pendingPaymentsQuery = useMemo(() => (ready ? qPendingPayments() : null), [ready]);
  const pendingReschedulesQuery = useMemo(
    () => (ready ? qPendingRescheduleRequests() : null),
    [ready],
  );
  const studentsQuery = useMemo(() => (ready ? qStudents() : null), [ready]);

  const { data: todaySessions, loading: todayLoading } = useFirestoreQuery<Session>(todaySessionsQuery);
  const { data: monthSessions } = useFirestoreQuery<Session>(monthSessionsQuery);
  const { data: allSessions } = useFirestoreQuery<Session>(allSessionsQuery);
  const { data: allPayments } = useFirestoreQuery<Payment>(allPaymentsQuery);
  const {
    data: pendingPayments,
    loading: pendingLoading,
    error: pendingPaymentsError,
  } = useFirestoreQuery<Payment>(pendingPaymentsQuery);
  const {
    data: pendingReschedules,
    error: pendingReschedulesError,
  } = useFirestoreQuery<Record<string, unknown>>(pendingReschedulesQuery);
  const { data: rawStudents } = useFirestoreQuery<Record<string, unknown>>(studentsQuery);

  const students = useMemo(
    () =>
      rawStudents.map((s: any) => ({
        id: String(s.id),
        fullName: String(s.fullName ?? s.id),
        feePerSessionCents: Math.max(0, Math.trunc(Number(s.feePerSessionCents ?? 0))),
        sessionDurationMin: Math.max(1, Math.trunc(Number(s.sessionDurationMin ?? 60))),
        active: Boolean(s.active ?? true),
      })),
    [rawStudents],
  );

  const studentsById = useMemo(() => {
    const m = new Map<string, { id: string; fullName: string }>();
    for (const s of students) m.set(s.id, { id: s.id, fullName: s.fullName });
    return m;
  }, [students]);

  const sortedPendingReschedules = useMemo(() => {
    return [...pendingReschedules].sort(
      (a, b) => Number((b as any).createdAt ?? 0) - Number((a as any).createdAt ?? 0),
    );
  }, [pendingReschedules]);

  const sortedPendingPayments = useMemo(() => {
    return [...pendingPayments].sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0));
  }, [pendingPayments]);

  const monthEarningsCents = useMemo(
    () => monthSessions.reduce((sum, s) => sum + (s.chargeCents ?? 0), 0),
    [monthSessions],
  );

  const totalsToDate = useMemo(() => {
    const totalEarnedCents = allSessions.reduce((sum, s) => sum + (s.chargeCents ?? 0), 0);
    const totalPaidCents = allPayments
      .filter((p) => p.status === "verified")
      .reduce((sum, p) => sum + (p.amountCents ?? 0), 0);
    const balanceCents = totalEarnedCents - totalPaidCents;
    return {
      totalEarnedCents,
      totalPaidCents,
      balanceCents,
      dueCents: Math.max(0, balanceCents),
      creditCents: Math.max(0, -balanceCents),
    };
  }, [allPayments, allSessions]);

  const studentSummaries = useMemo(() => {
    return students.map((student) => {
      const earned = allSessions
        .filter((s) => s.studentId === student.id)
        .reduce((sum, s) => sum + (s.chargeCents ?? 0), 0);
      const paid = allPayments
        .filter((p) => p.studentId === student.id && p.status === "verified")
        .reduce((sum, p) => sum + (p.amountCents ?? 0), 0);
      const balanceCents = earned - paid;
      return {
        studentId: student.id,
        studentName: student.fullName,
        earnedCents: earned,
        paidCents: paid,
        balanceCents,
        dueCents: Math.max(0, balanceCents),
        creditCents: Math.max(0, -balanceCents),
      };
    }).sort((a, b) => b.dueCents - a.dueCents);
  }, [allPayments, allSessions, students]);

  const outstandingStudents = useMemo(
    () => studentSummaries.filter((s) => s.dueCents > 0),
    [studentSummaries],
  );

  const visibleOutstandingStudents = useMemo(
    () => (showAllOutstanding ? outstandingStudents : outstandingStudents.slice(0, 10)),
    [outstandingStudents, showAllOutstanding],
  );

  const visibleFeeSetupStudents = useMemo(
    () => (showAllFeeSetup ? students : students.slice(0, 12)),
    [showAllFeeSetup, students],
  );

  const visibleStudentSummaries = useMemo(
    () => (showAllTotals ? studentSummaries : studentSummaries.slice(0, 12)),
    [showAllTotals, studentSummaries],
  );

  const monthlySummaries = useMemo(() => {
    return students.map((student) =>
      computeMonthlySummary({
        studentId: student.id,
        month: selectedMonth,
        sessions: allSessions,
        payments: allPayments,
      }),
    );
  }, [allPayments, allSessions, selectedMonth, students]);

  const visibleMonthlySummaries = useMemo(
    () => (showAllMonthlySummary ? monthlySummaries : monthlySummaries.slice(0, 12)),
    [monthlySummaries, showAllMonthlySummary],
  );

  const paymentTargetBalance = useMemo(() => {
    if (!paymentStudentId) return null;
    return studentSummaries.find((s) => s.studentId === paymentStudentId)?.balanceCents ?? null;
  }, [paymentStudentId, studentSummaries]);

  const lateCancelsToday = useMemo(
    () => todaySessions.filter((s) => s.status === "late_cancel").length,
    [todaySessions],
  );

  async function markSessionStatus(session: Session, status: AttendanceStatus) {
    setActionError(null);
    if (session.feePerSessionCents <= 0) {
      setActionError("Cannot calculate fee: this session has no valid base rate.");
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

  async function saveStudentFeeConfig(studentId: string, nextFeeLkr: string, nextDuration: string) {
    setActionError(null);
    const feeCents = Math.round(Number(nextFeeLkr) * 100);
    const duration = Math.trunc(Number(nextDuration));
    if (!Number.isFinite(feeCents) || feeCents <= 0) {
      setActionError("Rate per session must be greater than 0.");
      return;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      setActionError("Session duration must be greater than 0 minutes.");
      return;
    }
    await updateDoc(doc(db, col.students(), studentId), {
      feePerSessionCents: feeCents,
      sessionDurationMin: duration,
    });
  }

  async function addAdminPayment() {
    setActionError(null);
    if (!paymentStudentId) {
      setActionError("Select a student before adding a payment.");
      return;
    }

    const amountCents = Math.round(Number(paymentAmountLkr) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setActionError("Enter a valid payment amount.");
      return;
    }

    const paidAt = new Date(`${paymentDate}T12:00:00`).getTime();
    if (!Number.isFinite(paidAt)) {
      setActionError("Select a valid payment date.");
      return;
    }

    if (paymentTargetBalance != null && amountCents > paymentTargetBalance) {
      const proceed = window.confirm(
        "Payment exceeds current remaining balance. Save anyway?",
      );
      if (!proceed) return;
    }

    setPaymentSubmitting(true);
    try {
      const trimmedCoverageNote = paymentCoverageNote.trim();
      const trimmedNotes = paymentNotes.trim();
      await addDoc(collection(db, col.payments()), {
        studentId: paymentStudentId,
        amountCents,
        paidAt,
        method: paymentMethod,
        paymentType,
        ...(trimmedCoverageNote ? { coverageNote: trimmedCoverageNote } : {}),
        ...(trimmedNotes ? { notes: trimmedNotes } : {}),
        status: "verified",
        createdAt: Date.now(),
      });
      setPaymentAmountLkr("");
      setPaymentType("single");
      setPaymentCoverageNote("");
      setPaymentNotes("");
    } catch (err) {
      if (err instanceof FirebaseError && err.code === "permission-denied") {
        setActionError(
          "Missing permission to save payments. Publish the latest Firestore rules and ensure your user role is admin.",
        );
      } else {
        setActionError(err instanceof Error ? err.message : "Failed to save payment.");
      }
    } finally {
      setPaymentSubmitting(false);
    }
  }

  async function openSlip(payment: Payment) {
    setSlipActionError(null);
    setOpeningSlipPaymentId(payment.id);
    try {
      if (payment.slipPath) {
        try {
          const resolvedUrl = await getDownloadURL(ref(storage, payment.slipPath));
          await updateDoc(doc(db, col.payments(), payment.id), {
            slipUrl: resolvedUrl,
          });
          window.open(resolvedUrl, "_blank", "noopener,noreferrer");
          return;
        } catch {
          // Fall back to slipUrl/legacy parsing below when Storage is unavailable.
        }
      }
      if (!payment.slipUrl) {
        setSlipActionError("No slip file is attached to this payment.");
        return;
      }

      const legacyPath = extractStoragePathFromSlipUrl(payment.slipUrl);
      if (legacyPath) {
        const resolvedUrl = await getDownloadURL(ref(storage, legacyPath));
        await updateDoc(doc(db, col.payments(), payment.id), {
          slipPath: legacyPath,
          slipUrl: resolvedUrl,
        });
        window.open(resolvedUrl, "_blank", "noopener,noreferrer");
        return;
      }

      window.open(payment.slipUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setSlipActionError(err instanceof Error ? err.message : "Failed to open slip.");
    } finally {
      setOpeningSlipPaymentId((current) => (current === payment.id ? null : current));
    }
  }

  async function deletePayment(payment: Payment) {
    setSlipActionError(null);
    const proceed = window.confirm("Delete this payment record? This cannot be undone.");
    if (!proceed) return;
    try {
      await deleteDoc(doc(db, col.payments(), payment.id));
    } catch (err) {
      setSlipActionError(err instanceof Error ? err.message : "Failed to delete payment.");
    }
  }

  function exportPdf() {
    if (!selectedStudentForReport) {
      setActionError("Select a student before exporting a PDF report.");
      return;
    }
    const summary = computeMonthlySummary({
      studentId: selectedStudentForReport,
      month: selectedMonth,
      sessions: allSessions,
      payments: allPayments,
    });
    const rows = getMonthlyReportRows({
      studentId: selectedStudentForReport,
      month: selectedMonth,
      sessions: allSessions,
    });
    const studentName = studentsById.get(selectedStudentForReport)?.fullName ?? selectedStudentForReport;
    exportStudentMonthlyPdf({
      studentName,
      month: selectedMonth,
      summary,
      rows,
    });
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

      {actionError ? <div className="text-sm text-red-300">{actionError}</div> : null}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="card p-6">
          <div className="font-semibold">Today sessions</div>
          <div className="mt-2 text-sm text-[rgb(var(--muted))]">
            {todayLoading ? "Loading..." : `${todaySessions.length} sessions`}
          </div>
        </div>
        <div className="card p-6">
          <div className="font-semibold">Month earned</div>
          <div className="mt-2 text-sm text-[rgb(var(--muted))]">{formatMoneyLKR(monthEarningsCents)}</div>
        </div>
        <div className="card p-6">
          <div className="font-semibold">Total paid</div>
          <div className="mt-2 text-sm text-[rgb(var(--muted))]">{formatMoneyLKR(totalsToDate.totalPaidCents)}</div>
        </div>
        <div className="card p-6">
          <div className="font-semibold">Outstanding balance</div>
          <div className={`mt-2 text-sm font-semibold ${totalsToDate.dueCents > 0 ? "text-rose-500" : "text-emerald-500"}`}>
            {formatMoneyLKR(totalsToDate.dueCents)}
            <span className="ml-2 text-xs text-[rgb(var(--muted))]">({lateCancelsToday} late cancels today)</span>
          </div>
          {totalsToDate.creditCents > 0 ? (
            <div className="mt-1 text-xs text-emerald-500">Advance credit: {formatMoneyLKR(totalsToDate.creditCents)}</div>
          ) : null}
          <div className="mt-2 text-xs text-[rgb(var(--muted))]">
            Live total from all sessions minus verified payments.
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">Outstanding by student</div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-[rgb(var(--muted))]">
              {outstandingStudents.length} student{outstandingStudents.length === 1 ? "" : "s"} owe money right now
            </div>
            {outstandingStudents.length > 10 ? (
              <button className="btn btn-ghost" onClick={() => setShowAllOutstanding((v) => !v)}>
                {showAllOutstanding ? "Show less" : "Show all"}
              </button>
            ) : null}
          </div>
        </div>
        <div className="mt-1 text-xs text-[rgb(var(--muted))]">
          Shows only currently unpaid amounts after verified payments are deducted.
        </div>
        <div className="mt-3 grid gap-3 md:hidden">
          {visibleOutstandingStudents.map((row) => (
            <div key={row.studentId} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{row.studentName}</div>
                  <div className="text-xs text-[rgb(var(--muted))] font-mono">{row.studentId}</div>
                </div>
                <div className="text-right text-sm">
                  <div className="text-[rgb(var(--muted))]">Due</div>
                  <div className="font-semibold text-rose-500">{formatMoneyLKR(row.dueCents)}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-black/5 p-3 dark:bg-white/5">
                  <div className="text-[rgb(var(--muted))]">Earned</div>
                  <div className="font-semibold">{formatMoneyLKR(row.earnedCents)}</div>
                </div>
                <div className="rounded-lg bg-black/5 p-3 dark:bg-white/5">
                  <div className="text-[rgb(var(--muted))]">Balance</div>
                  <div className={`font-semibold ${row.balanceCents > 0 ? "text-rose-500" : "text-emerald-500"}`}>
                    {formatMoneyLKR(row.balanceCents)}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {outstandingStudents.length === 0 ? (
            <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-4 text-sm text-[rgb(var(--muted))]">
              No outstanding balances right now.
            </div>
          ) : null}
        </div>
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="text-left text-[rgb(var(--muted))]">
              <tr className="border-b border-[rgb(var(--border))]">
                <th className="py-2 pr-3">Student</th>
                <th className="py-2 pr-3 text-right">Earned</th>
                <th className="py-2 pr-3 text-right">Due</th>
              </tr>
            </thead>
            <tbody>
              {visibleOutstandingStudents.map((row) => (
                <tr key={row.studentId} className="border-b border-[rgb(var(--border))]">
                  <td className="py-2 pr-3">{row.studentName}</td>
                  <td className="py-2 pr-3 text-right">{formatMoneyLKR(row.earnedCents)}</td>
                  <td className="py-2 pr-3 text-right font-semibold text-rose-500">{formatMoneyLKR(row.dueCents)}</td>
                </tr>
              ))}
              {outstandingStudents.length === 0 ? (
                <tr>
                  <td className="py-4 text-[rgb(var(--muted))]" colSpan={3}>
                    No outstanding balances right now.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold">Fee setup per student</div>
          {students.length > 12 ? (
            <button className="btn btn-ghost" onClick={() => setShowAllFeeSetup((v) => !v)}>
              {showAllFeeSetup ? "Show less" : "Show all"}
            </button>
          ) : null}
        </div>
        <div className="mt-2 text-xs text-[rgb(var(--muted))]">
          Session charge is snapshot per session and is not recalculated later.
        </div>
        <div className="mt-3 grid gap-3 md:hidden">
          {visibleFeeSetupStudents.map((s) => (
            <div key={s.id} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-4">
              <div className="font-medium">{s.fullName}</div>
              <div className="text-xs text-[rgb(var(--muted))] font-mono">{s.id}</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <div className="label">Rate per session (LKR)</div>
                  <input className="input" defaultValue={(s.feePerSessionCents / 100).toFixed(2)} id={`fee-mobile-${s.id}`} inputMode="decimal" />
                </div>
                <div className="space-y-1">
                  <div className="label">Session duration (min)</div>
                  <input className="input" defaultValue={String(s.sessionDurationMin)} id={`dur-mobile-${s.id}`} inputMode="numeric" />
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  className="btn btn-primary w-full sm:w-auto"
                  onClick={() => {
                    const feeEl = document.getElementById(`fee-mobile-${s.id}`) as HTMLInputElement | null;
                    const durEl = document.getElementById(`dur-mobile-${s.id}`) as HTMLInputElement | null;
                    void saveStudentFeeConfig(s.id, feeEl?.value ?? "", durEl?.value ?? "");
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="text-left text-[rgb(var(--muted))]">
              <tr className="border-b border-[rgb(var(--border))]">
                <th className="py-2 pr-3">Student</th>
                <th className="py-2 pr-3">Rate per session (LKR)</th>
                <th className="py-2 pr-3">Session duration (min)</th>
                <th className="py-2 pr-3 text-right">Save</th>
              </tr>
            </thead>
            <tbody>
              {visibleFeeSetupStudents.map((s) => {
                return (
                  <tr key={s.id} className="border-b border-[rgb(var(--border))]">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{s.fullName}</div>
                      <div className="text-xs text-[rgb(var(--muted))] font-mono">{s.id}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        className="input"
                        defaultValue={(s.feePerSessionCents / 100).toFixed(2)}
                        id={`fee-${s.id}`}
                        inputMode="decimal"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input className="input" defaultValue={String(s.sessionDurationMin)} id={`dur-${s.id}`} inputMode="numeric" />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <button
                        className="btn btn-primary"
                        onClick={() => {
                          const feeEl = document.getElementById(`fee-${s.id}`) as HTMLInputElement | null;
                          const durEl = document.getElementById(`dur-${s.id}`) as HTMLInputElement | null;
                          void saveStudentFeeConfig(s.id, feeEl?.value ?? "", durEl?.value ?? "");
                        }}
                      >
                        Save
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-6">
        <div className="font-semibold">Today sessions: one-click attendance</div>
        <div className="mt-2 text-xs text-[rgb(var(--muted))]">
          Marking status updates financial charge instantly: attended = 100%, tutor cancel = 0%, early cancel = 0%, late cancel = 50%, no show = 100%.
        </div>
        <div className="mt-3 grid gap-3 md:hidden">
          {todaySessions.map((s) => (
            <div key={s.id} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{studentsById.get(s.studentId)?.fullName ?? s.studentId}</div>
                  <div className="text-xs text-[rgb(var(--muted))] font-mono">{s.studentId}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-[rgb(var(--muted))]">Time</div>
                  <div className="font-semibold">{formatTime(s.startAt)}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className={`status-pill ${s.status === "attended" ? "status-attended" : "status-scheduled"}`}>
                  {statusLabel(s.status)}
                </span>
                <span className="status-pill status-scheduled">{formatMoneyLKR(s.chargeCents)}</span>
              </div>
              <div className="mt-4 grid gap-2">
                <button
                  className={`btn w-full ${statusButtonClass(s.status === "attended", "attended")}`}
                  onClick={() => void markSessionStatus(s, "attended")}
                >
                  Attended
                </button>
                <button
                  className={`btn w-full ${statusButtonClass(s.status === "tutor_cancel", "tutor_cancel")}`}
                  onClick={() => void markSessionStatus(s, "tutor_cancel")}
                >
                  Tutor cancel
                </button>
                <button
                  className={`btn w-full ${statusButtonClass(s.status === "early_cancel", "early_cancel")}`}
                  onClick={() => void markSessionStatus(s, "early_cancel")}
                >
                  Early cancel
                </button>
                <button
                  className={`btn w-full ${statusButtonClass(s.status === "late_cancel", "late_cancel")}`}
                  onClick={() => void markSessionStatus(s, "late_cancel")}
                >
                  Late cancel
                </button>
                <button
                  className={`btn w-full ${statusButtonClass(s.status === "no_show", "no_show")}`}
                  onClick={() => void markSessionStatus(s, "no_show")}
                >
                  No show
                </button>
              </div>
            </div>
          ))}
          {todaySessions.length === 0 ? (
            <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-4 text-sm text-[rgb(var(--muted))]">
              No sessions found for today.
            </div>
          ) : null}
        </div>
        <div className="mt-3 hidden overflow-x-auto md:block">
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
                    <div className="font-medium">{studentsById.get(s.studentId)?.fullName ?? s.studentId}</div>
                    <div className="text-xs text-[rgb(var(--muted))] font-mono">{s.studentId}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        className={`btn ${statusButtonClass(s.status === "attended", "attended")}`}
                        onClick={() => void markSessionStatus(s, "attended")}
                      >
                        Attended
                      </button>
                      <button
                        className={`btn ${statusButtonClass(s.status === "tutor_cancel", "tutor_cancel")}`}
                        onClick={() => void markSessionStatus(s, "tutor_cancel")}
                      >
                        Tutor cancel
                      </button>
                      <button
                        className={`btn ${statusButtonClass(s.status === "early_cancel", "early_cancel")}`}
                        onClick={() => void markSessionStatus(s, "early_cancel")}
                      >
                        Early Cancel
                      </button>
                      <button
                        className={`btn ${statusButtonClass(s.status === "late_cancel", "late_cancel")}`}
                        onClick={() => void markSessionStatus(s, "late_cancel")}
                      >
                        Late Cancel
                      </button>
                      <button
                        className={`btn ${statusButtonClass(s.status === "no_show", "no_show")}`}
                        onClick={() => void markSessionStatus(s, "no_show")}
                      >
                        No Show
                      </button>
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold">{formatMoneyLKR(s.chargeCents)}</td>
                </tr>
              ))}
              {todaySessions.length === 0 ? (
                <tr>
                  <td className="py-6 text-center text-sm text-[rgb(var(--muted))]" colSpan={4}>
                    No sessions found for today.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-6">
        <div className="font-semibold">Add payment</div>
        <div className="mt-2 text-xs text-[rgb(var(--muted))]">
          If payment exceeds current balance, you will get a warning and can override.
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-6">
          <div className="space-y-1">
            <div className="label">Student *</div>
            <select className="input" value={paymentStudentId} onChange={(e) => setPaymentStudentId(e.target.value)} required aria-required="true">
              <option value="">Select student</option>
              {students.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <div className="label">Amount (LKR) *</div>
            <input className="input" value={paymentAmountLkr} onChange={(e) => setPaymentAmountLkr(e.target.value)} inputMode="decimal" required aria-required="true" />
          </div>
          <div className="space-y-1">
            <div className="label">Date *</div>
            <input className="input" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required aria-required="true" />
          </div>
          <div className="space-y-1">
            <div className="label">Method</div>
            <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              <option value="online">Online</option>
            </select>
          </div>
          <div className="space-y-1">
            <div className="label">Payment type</div>
            <select className="input" value={paymentType} onChange={(e) => setPaymentType(e.target.value as PaymentType)}>
              <option value="single">Single payment</option>
              <option value="prepaid_4_weeks">Prepaid 4 weeks</option>
              <option value="prepaid_8_weeks">Prepaid 8 weeks</option>
              <option value="settlement">Settlement</option>
            </select>
          </div>
          <div className="space-y-1 md:col-span-2">
            <div className="label">Coverage note</div>
            <input className="input" value={paymentCoverageNote} onChange={(e) => setPaymentCoverageNote(e.target.value)} placeholder="e.g. Covers May weeks 1-4" />
          </div>
          <div className="space-y-1 md:col-span-2">
            <div className="label">Notes</div>
            <input className="input" value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button className="btn btn-primary" disabled={paymentSubmitting} onClick={() => void addAdminPayment()}>
            {paymentSubmitting ? "Saving..." : "Save payment"}
          </button>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold">Per-student totals to date</div>
          {studentSummaries.length > 12 ? (
            <button className="btn btn-ghost" onClick={() => setShowAllTotals((v) => !v)}>
              {showAllTotals ? "Show less" : "Show all"}
            </button>
          ) : null}
        </div>
        <div className="mt-3 grid gap-3 md:hidden">
          {visibleStudentSummaries.map((row) => (
            <div key={row.studentId} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-4">
              <div className="font-medium">{row.studentName}</div>
              <div className="text-xs text-[rgb(var(--muted))] font-mono">{row.studentId}</div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-[rgb(var(--muted))]">Earned</div>
                  <div className="font-semibold">{formatMoneyLKR(row.earnedCents)}</div>
                </div>
                <div>
                  <div className="text-[rgb(var(--muted))]">Paid</div>
                  <div className="font-semibold">{formatMoneyLKR(row.paidCents)}</div>
                </div>
                <div className="col-span-2 rounded-lg bg-black/5 p-3 dark:bg-white/5">
                  <div className="text-[rgb(var(--muted))]">Balance</div>
                  <div className={`font-semibold ${row.balanceCents > 0 ? "text-rose-500" : "text-emerald-500"}`}>
                    {formatMoneyLKR(row.balanceCents)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="text-left text-[rgb(var(--muted))]">
              <tr className="border-b border-[rgb(var(--border))]">
                <th className="py-2 pr-3">Student</th>
                <th className="py-2 pr-3 text-right">Total earned</th>
                <th className="py-2 pr-3 text-right">Total paid</th>
                <th className="py-2 pr-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {visibleStudentSummaries.map((row) => (
                <tr key={row.studentId} className="border-b border-[rgb(var(--border))]">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{row.studentName}</div>
                    <div className="text-xs text-[rgb(var(--muted))] font-mono">{row.studentId}</div>
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold">{formatMoneyLKR(row.earnedCents)}</td>
                  <td className="py-2 pr-3 text-right font-semibold">{formatMoneyLKR(row.paidCents)}</td>
                  <td className={`py-2 pr-3 text-right font-semibold ${row.balanceCents > 0 ? "text-rose-500" : "text-emerald-500"}`}>
                    {formatMoneyLKR(row.balanceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="font-semibold">Monthly summary</div>
          <div className="flex items-center gap-2">
            <input className="input" type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} />
            {monthlySummaries.length > 12 ? (
              <button className="btn btn-ghost" onClick={() => setShowAllMonthlySummary((v) => !v)}>
                {showAllMonthlySummary ? "Show less" : "Show all"}
              </button>
            ) : null}
          </div>
        </div>
        <div className="mt-1 text-xs text-[rgb(var(--muted))]">
          Closing due and credit include carry-forward from prior months.
        </div>
        <div className="mt-3 grid gap-3 md:hidden">
          {visibleMonthlySummaries.map((row) => (
            <div key={row.studentId} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-4">
              <div className="font-medium">{studentsById.get(row.studentId)?.fullName ?? row.studentId}</div>
              <div className="text-xs text-[rgb(var(--muted))] font-mono">{row.studentId}</div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><div className="text-[rgb(var(--muted))]">Opening</div><div className="font-semibold">{formatMoneyLKR(row.openingBalanceCents)}</div></div>
                <div><div className="text-[rgb(var(--muted))]">Sessions</div><div className="font-semibold">{row.totalSessions}</div></div>
                <div><div className="text-[rgb(var(--muted))]">Attended</div><div className="font-semibold">{row.attendedCount}</div></div>
                <div><div className="text-[rgb(var(--muted))]">Late cancel</div><div className="font-semibold">{row.lateCancelCount}</div></div>
                <div><div className="text-[rgb(var(--muted))]">No show</div><div className="font-semibold">{row.noShowCount}</div></div>
                <div><div className="text-[rgb(var(--muted))]">Earned</div><div className="font-semibold">{formatMoneyLKR(row.totalEarnedCents)}</div></div>
                <div><div className="text-[rgb(var(--muted))]">Paid</div><div className="font-semibold">{formatMoneyLKR(row.totalPaidCents)}</div></div>
                <div><div className="text-[rgb(var(--muted))]">Closing due</div><div className="font-semibold text-rose-500">{formatMoneyLKR(row.dueCents)}</div></div>
                <div className="col-span-2 rounded-lg bg-black/5 p-3 dark:bg-white/5">
                  <div className="text-[rgb(var(--muted))]">Closing credit</div>
                  <div className="font-semibold text-emerald-500">{formatMoneyLKR(row.creditCents)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="text-left text-[rgb(var(--muted))]">
              <tr className="border-b border-[rgb(var(--border))]">
                <th className="py-2 pr-3">Student</th>
                <th className="py-2 pr-3 text-right">Opening</th>
                <th className="py-2 pr-3 text-right">Sessions</th>
                <th className="py-2 pr-3 text-right">Attended</th>
                <th className="py-2 pr-3 text-right">Late cancel</th>
                <th className="py-2 pr-3 text-right">No show</th>
                <th className="py-2 pr-3 text-right">Earned</th>
                <th className="py-2 pr-3 text-right">Paid</th>
                <th className="py-2 pr-3 text-right">Closing due</th>
                <th className="py-2 pr-3 text-right">Closing credit</th>
              </tr>
            </thead>
            <tbody>
              {visibleMonthlySummaries.map((row) => (
                <tr key={row.studentId} className="border-b border-[rgb(var(--border))]">
                  <td className="py-2 pr-3">{studentsById.get(row.studentId)?.fullName ?? row.studentId}</td>
                  <td className={`py-2 pr-3 text-right font-semibold ${row.openingBalanceCents > 0 ? "text-rose-500" : row.openingBalanceCents < 0 ? "text-emerald-500" : ""}`}>
                    {formatMoneyLKR(row.openingBalanceCents)}
                  </td>
                  <td className="py-2 pr-3 text-right">{row.totalSessions}</td>
                  <td className="py-2 pr-3 text-right">{row.attendedCount}</td>
                  <td className="py-2 pr-3 text-right">{row.lateCancelCount}</td>
                  <td className="py-2 pr-3 text-right">{row.noShowCount}</td>
                  <td className="py-2 pr-3 text-right">{formatMoneyLKR(row.totalEarnedCents)}</td>
                  <td className="py-2 pr-3 text-right">{formatMoneyLKR(row.totalPaidCents)}</td>
                  <td className="py-2 pr-3 text-right font-semibold text-rose-500">
                    {formatMoneyLKR(row.dueCents)}
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold text-emerald-500">
                    {formatMoneyLKR(row.creditCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-6">
        <div className="font-semibold">Export monthly report (PDF)</div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <div className="label">Student</div>
            <select className="input" value={selectedStudentForReport} onChange={(e) => setSelectedStudentForReport(e.target.value)}>
              <option value="">Select student</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <div className="label">Month</div>
            <input className="input" type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} />
          </div>
          <div className="flex items-end justify-end">
            <button className="btn btn-primary" onClick={exportPdf}>
              Export PDF
            </button>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="font-semibold">Pending payment slips</div>
        {pendingPaymentsError ? (
          <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200" aria-live="polite">
            {pendingPaymentsError}
          </div>
        ) : null}
        {slipActionError ? (
          <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200" aria-live="polite">
            {slipActionError}
          </div>
        ) : null}
        <div className="mt-3 grid gap-3 md:hidden">
          {sortedPendingPayments.map((p) => (
            <div key={p.id} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{studentsById.get(p.studentId)?.fullName ?? p.studentId}</div>
                  <div className="text-xs text-[rgb(var(--muted))] font-mono">{p.studentId}</div>
                </div>
                <div className="text-right font-semibold">{formatMoneyLKR(p.amountCents)}</div>
              </div>
              <div className="mt-3 text-sm text-[rgb(var(--muted))]">{(p.paymentType ?? "single").replaceAll("_", " ")}</div>
              <div className="mt-1 text-xs text-[rgb(var(--muted))]">{p.coverageNote ?? "-"}</div>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button className="btn btn-primary w-full" onClick={async () => { await updateDoc(doc(db, "payments", p.id), { status: "verified" }); }}>
                  Verify
                </button>
                <button className="btn btn-ghost w-full" onClick={async () => { await updateDoc(doc(db, "payments", p.id), { status: "rejected" }); }}>
                  Reject
                </button>
                <button className="btn btn-ghost w-full" onClick={() => void deletePayment(p)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
          {pendingLoading ? (
            <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-4 text-sm text-[rgb(var(--muted))]">Loading...</div>
          ) : null}
          {sortedPendingPayments.length === 0 ? (
            <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-4 text-sm text-[rgb(var(--muted))]">No pending payments.</div>
          ) : null}
        </div>
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="text-left text-[rgb(var(--muted))]">
              <tr className="border-b border-[rgb(var(--border))]">
                <th className="py-2 pr-3">Student</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3 text-right">Amount</th>
                <th className="py-2 pr-3">Slip</th>
                <th className="py-2 pr-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {sortedPendingPayments.map((p) => (
                <tr key={p.id} className="border-b border-[rgb(var(--border))]">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{studentsById.get(p.studentId)?.fullName ?? p.studentId}</div>
                    <div className="text-xs text-[rgb(var(--muted))] font-mono">{p.studentId}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="font-medium">{(p.paymentType ?? "single").replaceAll("_", " ")}</div>
                    <div className="text-xs text-[rgb(var(--muted))]">{p.coverageNote ?? "-"}</div>
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold">{formatMoneyLKR(p.amountCents)}</td>
                  <td className="py-2 pr-3">
                    {p.slipUrl || p.slipPath ? (
                      <button className="btn btn-ghost" onClick={() => void openSlip(p)} disabled={openingSlipPaymentId === p.id}>
                        {openingSlipPaymentId === p.id ? "Opening..." : "Open slip"}
                      </button>
                    ) : (
                      <span className="text-[rgb(var(--muted))]">-</span>
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
                      <button className="btn btn-ghost" onClick={() => void deletePayment(p)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {pendingLoading ? (
                <tr>
                  <td className="py-6 text-center text-sm text-[rgb(var(--muted))]" colSpan={5}>
                    Loading...
                  </td>
                </tr>
              ) : null}
              {sortedPendingPayments.length === 0 ? (
                <tr>
                  <td className="py-6 text-center text-sm text-[rgb(var(--muted))]" colSpan={5}>
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
        {pendingReschedulesError ? (
          <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200" aria-live="polite">
            {pendingReschedulesError}
          </div>
        ) : null}
        <div className="mt-3 grid gap-3 md:hidden">
          {sortedPendingReschedules.map((r: any) => (
            <div key={r.id} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-4">
              <div className="font-medium">{studentsById.get(String(r.studentId ?? ""))?.fullName ?? String(r.studentId ?? "")}</div>
              <div className="text-xs text-[rgb(var(--muted))] font-mono">{String(r.studentId ?? "")}</div>
              <div className="mt-3 text-sm text-[rgb(var(--muted))]">From session: {String(r.fromSessionId ?? "")}</div>
              <div className="mt-1 text-sm text-[rgb(var(--muted))]">
                Requested: {r.requestedStartAt ? new Date(Number(r.requestedStartAt)).toLocaleString() : "-"}
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  className="btn btn-primary w-full"
                  onClick={async () => {
                    const reqId = String(r.id);
                    const fromSessionId = String(r.fromSessionId);
                    const session = allSessions.find((s) => s.id === fromSessionId);
                    const requestedStartAt = Number(r.requestedStartAt);
                    const requestedEndAt = Number(r.requestedEndAt);
                    const rescheduleNote = `rescheduled to ${new Date(requestedStartAt).toLocaleString("en-LK", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}`;

                    if (!session) {
                      throw new Error("Original session could not be found.");
                    }

                    await updateDoc(doc(db, "sessions", fromSessionId), {
                      startAt: requestedStartAt,
                      endAt: requestedEndAt,
                      createdFrom: "reschedule",
                    });

                    if (session.slotId) {
                      const slotRef = doc(db, col.timetableSlots(), session.slotId);
                      await updateDoc(slotRef, {
                        exceptions: arrayUnion(
                          `${new Date(session.startAt).toISOString().slice(0, 10)} | ${rescheduleNote}`,
                        ),
                      });
                    }

                    await updateDoc(doc(db, "rescheduleRequests", reqId), {
                      status: "approved",
                      updatedAt: Date.now(),
                    });
                  }}
                >
                  Approve
                </button>
                <button
                  className="btn btn-ghost w-full"
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
            </div>
          ))}
          {!pendingReschedulesError && sortedPendingReschedules.length === 0 ? (
            <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-4 text-sm text-[rgb(var(--muted))]">
              No reschedule requests.
            </div>
          ) : null}
        </div>
        <div className="mt-3 hidden overflow-x-auto md:block">
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
              {sortedPendingReschedules.map((r: any) => (
                <tr key={r.id} className="border-b border-[rgb(var(--border))]">
                  <td className="py-2 pr-3">
                    <div className="font-medium">
                      {studentsById.get(String(r.studentId ?? ""))?.fullName ?? String(r.studentId ?? "")}
                    </div>
                    <div className="text-xs text-[rgb(var(--muted))] font-mono">{String(r.studentId ?? "")}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="font-mono text-xs text-[rgb(var(--muted))]">{String(r.fromSessionId ?? "")}</span>
                  </td>
                  <td className="py-2 pr-3">
                    {r.requestedStartAt ? new Date(Number(r.requestedStartAt)).toLocaleString() : "-"}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        className="btn btn-primary"
                        onClick={async () => {
                          const reqId = String(r.id);
                          const fromSessionId = String(r.fromSessionId);
                          const session = allSessions.find((s) => s.id === fromSessionId);
                          const requestedStartAt = Number(r.requestedStartAt);
                          const requestedEndAt = Number(r.requestedEndAt);
                          const rescheduleNote = `rescheduled to ${new Date(requestedStartAt).toLocaleString("en-LK", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}`;

                          if (!session) {
                            throw new Error("Original session could not be found.");
                          }

                          await updateDoc(doc(db, "sessions", fromSessionId), {
                            startAt: requestedStartAt,
                            endAt: requestedEndAt,
                            createdFrom: "reschedule",
                          });

                          if (session.slotId) {
                            const slotRef = doc(db, col.timetableSlots(), session.slotId);
                            await updateDoc(slotRef, {
                              exceptions: arrayUnion(
                                `${new Date(session.startAt).toISOString().slice(0, 10)} | ${rescheduleNote}`,
                              ),
                            });
                          }

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
              {!pendingReschedulesError && sortedPendingReschedules.length === 0 ? (
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
