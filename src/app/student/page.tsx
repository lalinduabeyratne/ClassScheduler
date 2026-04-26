"use client";

import { collection, limit, query, where } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { db, storage } from "@/lib/firebase/client";
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
import { allocateVerifiedPaymentsOldestFirst, computeStudentBalance } from "@/lib/billing/rollup";
import type { Payment, Session, Student } from "@/lib/model/types";
import { createPaymentWithSlip, replacePaymentSlip } from "@/lib/payments/createPaymentWithSlip";
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

function toDateTimeLocalValue(ms: number) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

const MISSED_STATUSES = new Set<Session["status"]>(["early_cancel", "late_cancel", "no_show"]);
const TUTOR_CANCELED_STATUS: Session["status"] = "tutor_cancel";

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

const MAX_SLIP_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_DIMENSION_PX = 1800;
const IMAGE_QUALITY = 0.82;

function ensureSupportedSlipType(file: File) {
  const name = file.name.toLowerCase();
  const byMimeImage = file.type.startsWith("image/");
  const byMimePdf = file.type === "application/pdf";
  const byExtImage = /\.(jpg|jpeg|png|webp|heic|heif)$/i.test(name);
  const byExtPdf = /\.pdf$/i.test(name);
  const isImage = byMimeImage || byExtImage;
  const isPdf = byMimePdf || byExtPdf;
  if (!isImage && !isPdf) {
    throw new Error("Unsupported file type. Please upload an image or PDF.");
  }
}

function getScaledSize(width: number, height: number) {
  const maxSide = Math.max(width, height);
  if (maxSide <= MAX_IMAGE_DIMENSION_PX) {
    return { width, height };
  }
  const scale = MAX_IMAGE_DIMENSION_PX / maxSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function compressImageFile(file: File): Promise<File> {
  const canAttemptImageCompression = file.type.startsWith("image/") || /\.(jpg|jpeg|png|webp)$/i.test(file.name);
  if (!canAttemptImageCompression) return file;

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error("Image decode failed"));
      node.src = objectUrl;
    }).catch(() => null);

    if (!img) return file;

    const scaled = getScaledSize(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const canvas = document.createElement("canvas");
    canvas.width = scaled.width;
    canvas.height = scaled.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(img, 0, 0, scaled.width, scaled.height);
    const compressedBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", IMAGE_QUALITY);
    });

    if (!compressedBlob || compressedBlob.size >= file.size) return file;
    const jpegName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([compressedBlob], jpegName, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function prepareSlipForUpload(file: File): Promise<File> {
  ensureSupportedSlipType(file);
  const optimized = await compressImageFile(file);
  if (optimized.size > MAX_SLIP_BYTES) {
    throw new Error("File is too large. Keep it under 20MB.");
  }
  return optimized;
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
  const [payUploadPercent, setPayUploadPercent] = useState(0);
  const [payError, setPayError] = useState<string | null>(null);
  const [paySuccess, setPaySuccess] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historySuccess, setHistorySuccess] = useState<string | null>(null);
  const [openingSlipPaymentId, setOpeningSlipPaymentId] = useState<string | null>(null);
  const [reuploadPaymentId, setReuploadPaymentId] = useState<string | null>(null);
  const [reuploadFile, setReuploadFile] = useState<File | null>(null);
  const [reuploadSubmitting, setReuploadSubmitting] = useState(false);
  const [reuploadPercent, setReuploadPercent] = useState(0);
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
  const paymentCoverage = useMemo(
    () => allocateVerifiedPaymentsOldestFirst({ sessions, payments }),
    [payments, sessions],
  );
  const pendingPaymentCents = useMemo(
    () =>
      payments
        .filter((payment) => payment.status === "pending_verification")
        .reduce((sum, payment) => sum + (payment.amountCents ?? 0), 0),
    [payments],
  );
  const projectedDueAfterPendingCents = Math.max(0, duePaymentCents - pendingPaymentCents);

  const upcomingSessions = useMemo(() => {
    const nowMs = Date.now();
    return sessions
      .filter((s) => (s.startAt ?? 0) > nowMs)
      .sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0))
      .slice(0, 10);
  }, [sessions]);

  const sessionsPrepaidCoverage = useMemo(() => {
    const scheduledUpcoming = upcomingSessions.filter(
      (session) => session.status === "scheduled" && Math.max(0, Number(session.feePerSessionCents ?? 0)) > 0,
    );

    let remainingCredit = paymentCoverage.remainingCreditCents;
    const coveredIds = new Set<string>(paymentCoverage.fullyPaidSessionIds);

    // Mark additional sessions covered by remaining credit
    for (const session of scheduledUpcoming) {
      if (coveredIds.has(session.id)) continue;
      const chargeCents = Math.max(0, Number(session.feePerSessionCents ?? 0));
      if (remainingCredit >= chargeCents) {
        coveredIds.add(session.id);
        remainingCredit -= chargeCents;
      }
    }

    return coveredIds;
  }, [paymentCoverage, upcomingSessions]);

  const prepaidUpcomingSummary = useMemo(() => {
    const scheduledUpcoming = upcomingSessions.filter(
      (session) => session.status === "scheduled" && Math.max(0, Number(session.feePerSessionCents ?? 0)) > 0,
    );
    const fullyPaidUpcoming = scheduledUpcoming.filter((session) =>
      sessionsPrepaidCoverage.has(session.id),
    );

    return {
      paidCount: fullyPaidUpcoming.length,
      paidCents: fullyPaidUpcoming.reduce((sum, session) => sum + Math.max(0, Number(session.feePerSessionCents ?? 0)), 0),
    };
  }, [sessionsPrepaidCoverage, upcomingSessions]);

  const missedSessions = useMemo(() => {
    const nowMs = Date.now();
    return sessions
      .filter((s) => MISSED_STATUSES.has(s.status) && (s.startAt ?? 0) <= nowMs)
      .sort((a, b) => (b.startAt ?? 0) - (a.startAt ?? 0));
  }, [sessions]);

  const tutorCanceledSessions = useMemo(() => {
    const nowMs = Date.now();
    return sessions
      .filter((s) => s.status === TUTOR_CANCELED_STATUS && (s.startAt ?? 0) <= nowMs)
      .sort((a, b) => (b.startAt ?? 0) - (a.startAt ?? 0));
  }, [sessions]);

  const missedSummary = useMemo(() => {
    const earlyCancelCount = missedSessions.filter((s) => s.status === "early_cancel").length;
    const lateCancelCount = missedSessions.filter((s) => s.status === "late_cancel").length;
    const noShowCount = missedSessions.filter((s) => s.status === "no_show").length;

    return {
      totalMissed: missedSessions.length,
      tutorCanceledCount: tutorCanceledSessions.length,
      totalToCatchUp: missedSessions.length + tutorCanceledSessions.length,
      earlyCancelCount,
      lateCancelCount,
      noShowCount,
    };
  }, [missedSessions, tutorCanceledSessions]);

  const reschedulableSessions = useMemo(() => {
    const seen = new Set<string>();
    const merged = [...missedSessions.slice(0, 20), ...tutorCanceledSessions.slice(0, 20), ...upcomingSessions];
    return merged.filter((session) => {
      if (seen.has(session.id)) return false;
      seen.add(session.id);
      return true;
    });
  }, [missedSessions, tutorCanceledSessions, upcomingSessions]);

  const paymentHistory = useMemo(() => {
    return [...payments].sort((a, b) => b.paidAt - a.paidAt).slice(0, 30);
  }, [payments]);

  const unpaidSessions = useMemo(() => {
    const chargedSessions = [...sessions]
      .filter((session) => Number(session.chargeCents ?? 0) > 0)
      .sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0));

    let paidCentsRemaining = payments
      .filter((payment) => payment.status === "verified")
      .reduce((sum, payment) => sum + (payment.amountCents ?? 0), 0);

    const outstanding: Array<Session & { unpaidCents: number }> = [];

    for (const session of chargedSessions) {
      const chargeCents = Math.max(0, Number(session.chargeCents ?? 0));
      if (chargeCents <= 0) continue;

      if (paidCentsRemaining >= chargeCents) {
        paidCentsRemaining -= chargeCents;
        continue;
      }

      const unpaidCents = chargeCents - Math.max(0, paidCentsRemaining);
      paidCentsRemaining = 0;
      outstanding.push({ ...session, unpaidCents });
    }

    return outstanding
      .sort((a, b) => (b.startAt ?? 0) - (a.startAt ?? 0))
      .slice(0, 12);
  }, [payments, sessions]);

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
    () => reschedulableSessions.find((s) => s.id === rescheduleSessionId) ?? null,
    [rescheduleSessionId, reschedulableSessions],
  );
  const rescheduleMinDateTime = useMemo(() => toDateTimeLocalValue(Date.now()), [rescheduleNewStart]);

  async function openPaymentSlip(payment: Payment) {
    setHistoryError(null);
    setHistorySuccess(null);
    setOpeningSlipPaymentId(payment.id);
    try {
      if (payment.slipPath) {
        try {
          const resolvedUrl = await getDownloadURL(ref(storage, payment.slipPath));
          window.open(resolvedUrl, "_blank", "noopener,noreferrer");
          return;
        } catch {
          // Fall back to slipUrl/legacy parsing below when Storage is unavailable.
        }
      }
      if (!payment.slipUrl) {
        setHistoryError("No slip is attached for this payment.");
        return;
      }

      const legacyPath = extractStoragePathFromSlipUrl(payment.slipUrl);
      if (legacyPath) {
        const resolvedUrl = await getDownloadURL(ref(storage, legacyPath));
        window.open(resolvedUrl, "_blank", "noopener,noreferrer");
        return;
      }

      window.open(payment.slipUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Failed to open slip.");
    } finally {
      setOpeningSlipPaymentId((current) => (current === payment.id ? null : current));
    }
  }

  async function submitSlipReupload() {
    setHistoryError(null);
    setHistorySuccess(null);
    if (!studentId || !reuploadPaymentId) {
      setHistoryError("Select a payment to re-upload the slip.");
      return;
    }
    if (!reuploadFile) {
      setHistoryError("Please choose an image/PDF slip file first.");
      return;
    }

    setReuploadSubmitting(true);
    setReuploadPercent(0);
    try {
      const optimizedFile = await prepareSlipForUpload(reuploadFile);
      await replacePaymentSlip({
        paymentId: reuploadPaymentId,
        studentId,
        file: optimizedFile,
        onProgress: (percent) => setReuploadPercent(percent),
      });
      setReuploadFile(null);
      setReuploadPaymentId(null);
      setReuploadPercent(100);
      setHistorySuccess("Slip re-uploaded successfully. Status is now pending verification.");
    } catch (err) {
      setReuploadPercent(0);
      setHistoryError(err instanceof Error ? err.message : "Failed to re-upload slip.");
    } finally {
      setReuploadSubmitting(false);
    }
  }
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
            <div className="mt-3 grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-[rgb(var(--border))] bg-black/5 px-3 py-2 dark:bg-white/5">
                <div className="text-xs text-[rgb(var(--muted))]">Pending verification</div>
                <div className="font-semibold">{formatMoneyLKR(pendingPaymentCents)}</div>
              </div>
              <div className="rounded-lg border border-[rgb(var(--border))] bg-black/5 px-3 py-2 dark:bg-white/5">
                <div className="text-xs text-[rgb(var(--muted))]">Projected due after pending</div>
                <div className="font-semibold">{formatMoneyLKR(projectedDueAfterPendingCents)}</div>
              </div>
              <div className="rounded-lg border border-[rgb(var(--border))] bg-emerald-500/10 px-3 py-2">
                <div className="text-xs text-[rgb(var(--muted))]">Prepaid for upcoming</div>
                <div className="font-semibold">{formatMoneyLKR(prepaidUpcomingSummary.paidCents)}</div>
                <div className="text-[11px] text-[rgb(var(--muted))]">
                  {prepaidUpcomingSummary.paidCount} scheduled classes already covered
                </div>
              </div>
              <div className="rounded-lg border border-[rgb(var(--border))] bg-indigo-500/10 px-3 py-2">
                <div className="text-xs text-[rgb(var(--muted))]">Advance balance</div>
                <div className="font-semibold">{formatMoneyLKR(paymentCoverage.remainingCreditCents)}</div>
              </div>
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

      <div className="card border-amber-500/40 bg-amber-500/10 p-6">
        <div className="font-semibold text-amber-200">Classes to catch up</div>
        <div className="mt-1 text-xs text-rose-100/80">
          Missed or canceled classes can slow progress. Request make-up classes to stay on track.
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <div className="text-xs text-amber-100/80">Total to catch up</div>
            <div className="text-xl font-semibold text-amber-100">{missedSummary.totalToCatchUp}</div>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <div className="text-xs text-amber-100/80">You canceled early</div>
            <div className="text-xl font-semibold text-amber-100">{missedSummary.earlyCancelCount}</div>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <div className="text-xs text-amber-100/80">You canceled late</div>
            <div className="text-xl font-semibold text-amber-100">{missedSummary.lateCancelCount}</div>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <div className="text-xs text-amber-100/80">No show</div>
            <div className="text-xl font-semibold text-amber-100">{missedSummary.noShowCount}</div>
          </div>
          <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3">
            <div className="text-xs text-indigo-100/80">Tutor canceled</div>
            <div className="text-xl font-semibold text-indigo-100">{missedSummary.tutorCanceledCount}</div>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="font-semibold">Unpaid sessions</div>
        <div className="mt-1 text-xs text-[rgb(var(--muted))]">
          Oldest session charges are covered first using verified payments.
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
                  <th className="py-2 pr-3 text-right">Unpaid amount</th>
                </tr>
              </thead>
              <tbody>
                {unpaidSessions.map((s) => (
                  <tr key={s.id} className="border-b border-[rgb(var(--border))]">
                    <td className="py-2 pr-3">{formatDateTimeCompact(s.startAt)}</td>
                    <td className="py-2 pr-3">{s.status.replaceAll("_", " ")}</td>
                    <td className="py-2 pr-3 text-right">{formatMoneyLKR(s.unpaidCents)}</td>
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
                  {upcomingSessions.slice(0, 3).map((s) => {
                    const isScheduledPaid =
                      s.status === "scheduled" &&
                      sessionsPrepaidCoverage.has(s.id) &&
                      Math.max(0, Number(s.feePerSessionCents ?? 0)) > 0;
                    return (
                      <li key={s.id} className="flex items-center justify-between gap-3">
                        <div className="font-medium">{formatDateTimeCompact(s.startAt)}</div>
                        <div className="flex items-center gap-2 text-xs text-[rgb(var(--muted))]">
                          <span>{s.status.replaceAll("_", " ")}</span>
                          {isScheduledPaid ? (
                            <span className="rounded-full border border-emerald-400/60 bg-emerald-500/15 px-2 py-0.5 text-emerald-200">
                              Already paid
                            </span>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
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
              setPayUploadPercent(0);
              try {
                const optimizedFile = await prepareSlipForUpload(payFile);
                await createPaymentWithSlip({
                  studentId,
                  amountCents: payAmountCents,
                  file: optimizedFile,
                  onProgress: (percent) => setPayUploadPercent(percent),
                });
                setPayAmountLkr("");
                setPayFile(null);
                setPayUploadPercent(100);
                setPaySuccess("Payment submitted successfully. It will stay pending until verified.");
              } catch (err) {
                setPayUploadPercent(0);
                setPayError(err instanceof Error ? err.message : "Upload failed");
              } finally {
                setPaySubmitting(false);
              }
            }}
          >
            <div className="space-y-1">
              <div className="label">Amount (LKR) *</div>
              <input
                className="input"
                value={payAmountLkr}
                onChange={(e) => setPayAmountLkr(e.target.value)}
                placeholder="5000"
                inputMode="decimal"
                required
                aria-required="true"
                aria-invalid={Boolean(payAmountError)}
              />
              <div className={`text-xs ${payAmountError ? "text-rose-300" : "text-[rgb(var(--muted))]"}`}>
                {payAmountError ? payAmountError : `You are about to submit ${formatMoneyLKR(payAmountCents)}.`}
              </div>
            </div>
            <div className="space-y-1 md:col-span-2">
              <div className="label">Slip (image or PDF) *</div>
              <input
                className="input"
                type="file"
                accept="image/*,application/pdf"
                required
                aria-required="true"
                onChange={(e) => setPayFile(e.target.files?.[0] ?? null)}
              />
              <div className="text-xs text-[rgb(var(--muted))]">
                {payFile ? `Selected file: ${payFile.name}` : "Choose an image or PDF receipt (max 20MB)."}
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

            {paySubmitting ? (
              <div className="md:col-span-3 space-y-2" aria-live="polite">
                <div className="flex items-center justify-between text-xs text-[rgb(var(--muted))]">
                  <span>Uploading slip</span>
                  <span>{payUploadPercent}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[rgb(var(--border))]">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-200"
                    style={{ width: `${payUploadPercent}%` }}
                  />
                </div>
              </div>
            ) : null}

            <div className="md:col-span-3 flex items-center justify-end">
              <button className="btn btn-primary" disabled={!canSubmitPayment}>
                {paySubmitting ? `Uploading ${payUploadPercent}%` : "Submit payment"}
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
            {historyError ? (
              <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200" aria-live="polite">
                {historyError}
              </div>
            ) : null}
            {historySuccess ? (
              <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200" aria-live="polite">
                {historySuccess}
              </div>
            ) : null}

            {reuploadPaymentId ? (
              <div className="mb-3 space-y-3 rounded-lg border border-[rgb(var(--border))] p-3">
                <div className="text-sm font-medium">Re-upload slip</div>
                <div className="text-xs text-[rgb(var(--muted))]">Selected payment ID: {reuploadPaymentId}</div>
                <input
                  className="input"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setReuploadFile(e.target.files?.[0] ?? null)}
                />
                {reuploadSubmitting ? (
                  <div className="space-y-2" aria-live="polite">
                    <div className="flex items-center justify-between text-xs text-[rgb(var(--muted))]">
                      <span>Uploading replacement slip</span>
                      <span>{reuploadPercent}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[rgb(var(--border))]">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-200"
                        style={{ width: `${reuploadPercent}%` }}
                      />
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap justify-end gap-2">
                  <button className="btn btn-ghost" onClick={() => {
                    setReuploadPaymentId(null);
                    setReuploadFile(null);
                    setReuploadPercent(0);
                  }} disabled={reuploadSubmitting}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" onClick={() => void submitSlipReupload()} disabled={reuploadSubmitting || !reuploadFile}>
                    {reuploadSubmitting ? `Uploading ${reuploadPercent}%` : "Upload replacement slip"}
                  </button>
                </div>
              </div>
            ) : null}

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
                    <div className="col-span-2">
                      Slip:{" "}
                      {p.slipUrl || p.slipPath ? (
                        <button className="btn btn-ghost" onClick={() => void openPaymentSlip(p)} disabled={openingSlipPaymentId === p.id}>
                          {openingSlipPaymentId === p.id ? "Opening..." : "Open slip"}
                        </button>
                      ) : (
                        "-"
                      )}
                    </div>
                    {p.status !== "verified" ? (
                      <div className="col-span-2">
                        <button
                          className="btn btn-ghost"
                          onClick={() => {
                            setReuploadPaymentId(p.id);
                            setReuploadFile(null);
                            setReuploadPercent(0);
                            setHistoryError(null);
                            setHistorySuccess(null);
                          }}
                        >
                          Re-upload slip
                        </button>
                      </div>
                    ) : null}
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
                    <th className="py-2 pr-3">Slip</th>
                    <th className="py-2 pr-3 text-right">Amount</th>
                    <th className="py-2 pr-3 text-right">Action</th>
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
                      <td className="py-2 pr-3">
                        {p.slipUrl || p.slipPath ? (
                          <button className="btn btn-ghost" onClick={() => void openPaymentSlip(p)} disabled={openingSlipPaymentId === p.id}>
                            {openingSlipPaymentId === p.id ? "Opening..." : "Open slip"}
                          </button>
                        ) : (
                          <span className="text-[rgb(var(--muted))]">-</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right">{formatMoneyLKR(p.amountCents)}</td>
                      <td className="py-2 pr-3 text-right">
                        {p.status !== "verified" ? (
                          <button
                            className="btn btn-ghost"
                            onClick={() => {
                              setReuploadPaymentId(p.id);
                              setReuploadFile(null);
                              setReuploadPercent(0);
                              setHistoryError(null);
                              setHistorySuccess(null);
                            }}
                          >
                            Re-upload slip
                          </button>
                        ) : (
                          <span className="text-[rgb(var(--muted))]">-</span>
                        )}
                      </td>
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
            Canceled and missed sessions are marked clearly. Use this to request a make-up class.
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
                {tutorCanceledSessions.slice(0, 20).map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatDateTimeCompact(s.startAt)} (TUTOR CANCELED)
                  </option>
                ))}
                {missedSessions.slice(0, 20).map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatDateTimeCompact(s.startAt)} (MISSED - {s.status.replaceAll("_", " ")})
                  </option>
                ))}
                {upcomingSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatDateTimeCompact(s.startAt)} (current)
                  </option>
                ))}
              </select>
              {reschedulableSessions.length === 0 ? (
                <div className="pt-1 text-xs text-[rgb(var(--muted))]">
                  No eligible sessions found yet.
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
                min={rescheduleMinDateTime}
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

