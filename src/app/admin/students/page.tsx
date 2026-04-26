"use client";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AdminTopNav } from "@/app/admin/_components/AdminTopNav";
import { computeChargeCents } from "@/lib/billing/fee";
import { exportStudentComprehensiveReport } from "@/lib/billing/exportPdf";
import { allocateVerifiedPaymentsOldestFirst, computeStudentBalance } from "@/lib/billing/rollup";
import { db, storage } from "@/lib/firebase/client";
import { createAuthUserWithEmailPassword } from "@/lib/firebase/createAuthUser";
import {
  qPaymentsBetween,
  qRescheduleForStudent,
  qSessionsBetween,
  qStudents,
  qTimetableSlots,
} from "@/lib/firestore/api";
import { useFirestoreQuery } from "@/lib/firestore/hooks";
import { col } from "@/lib/firestore/paths";
import type { Payment, Session } from "@/lib/model/types";
import { getUserRole } from "@/lib/roles/getUserRole";
import { useAuthUser } from "@/lib/firebase/useAuthUser";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const DAY_TO_WEEKDAY: Record<(typeof DAYS)[number], number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

type SlotStudent = { id: string; name: string };
type SlotDoc = {
  id: string;
  dayLabel: string;
  weekday: number;
  startTime: string;
  endTime: string;
  duration: number;
  students: SlotStudent[];
  isLocked: boolean;
};

function formatMoneyLKR(cents: number) {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 2,
  }).format((cents ?? 0) / 100);
}

function statusPillClass(status: string) {
  if (status === "attended") return "status-pill status-attended";
  if (status === "tutor_cancel") return "status-pill status-tutor-cancel";
  if (status === "late_cancel") return "status-pill status-late-cancel";
  if (status === "no_show") return "status-pill status-no-show";
  return "status-pill status-early-cancel";
}

function randomPassword() {
  return `Class@${Math.random().toString(36).slice(2, 8)}9`;
}

function yyyymmdd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function yyyymm(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function combineDateTimeMs(d: Date, hhmm: string) {
  const [hh, mm] = hhmm.split(":").map((x) => Number(x));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh || 0, mm || 0).getTime();
}

const MISSED_STATUSES = new Set<Session["status"]>(["early_cancel", "late_cancel", "no_show"]);

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

export default function AdminStudentsPage() {
  const router = useRouter();
  const { user, loading } = useAuthUser();
  const [checkingRole, setCheckingRole] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [selectedStudentId, setSelectedStudentId] = useState("");

  const [fullName, setFullName] = useState("");
  const [parentName, setParentName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [email, setEmail] = useState("");
  const [feeLkr, setFeeLkr] = useState("5000");
  const [sessionDurationMin, setSessionDurationMin] = useState("180");
  const [assignedSlotIds, setAssignedSlotIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const [editFullName, setEditFullName] = useState("");
  const [editParentName, setEditParentName] = useState("");
  const [editContactNumber, setEditContactNumber] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editFeeLkr, setEditFeeLkr] = useState("");
  const [editSessionDuration, setEditSessionDuration] = useState("");
  const [editAssignedSlotIds, setEditAssignedSlotIds] = useState<string[]>([]);
  const [reportMonth, setReportMonth] = useState(() => yyyymm(new Date()));
  const [saving, setSaving] = useState(false);
  const [openingSlipPaymentId, setOpeningSlipPaymentId] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    (async () => {
      try {
        const role = await getUserRole(user.uid);
        if (role !== "admin") {
          router.replace(role === "student" ? "/student" : "/login");
          return;
        }
      } catch (err) {
        setAccessError(err instanceof Error ? err.message : "Role check failed.");
      } finally {
        setCheckingRole(false);
      }
    })();
  }, [loading, router, user]);

  const ready = !loading && !checkingRole && !accessError;
  const studentsQuery = useMemo(() => (ready ? qStudents() : null), [ready]);
  const slotsQuery = useMemo(() => (ready ? qTimetableSlots() : null), [ready]);

  const allStartMs = new Date(2020, 0, 1).getTime();
  const allEndMs = new Date(2035, 0, 1).getTime();
  const sessionsQuery = useMemo(
    () => (ready ? qSessionsBetween({ startAtMs: allStartMs, endAtMs: allEndMs }) : null),
    [allEndMs, allStartMs, ready],
  );
  const paymentsQuery = useMemo(
    () => (ready ? qPaymentsBetween({ startAtMs: allStartMs, endAtMs: allEndMs }) : null),
    [allEndMs, allStartMs, ready],
  );

  const { data: rawStudents } = useFirestoreQuery<Record<string, unknown>>(studentsQuery);
  const { data: rawSlots } = useFirestoreQuery<Record<string, unknown>>(slotsQuery);
  const { data: sessions } = useFirestoreQuery<Session>(sessionsQuery);
  const { data: payments } = useFirestoreQuery<Payment>(paymentsQuery);

  const students = useMemo(
    () =>
      rawStudents.map((s: any) => ({
        id: String(s.id),
        fullName: String(s.fullName ?? s.id),
        parentName: String(s.parentName ?? ""),
        contactNumber: String(s.contactNumber ?? ""),
        email: String(s.email ?? ""),
        authUid: String(s.authUid ?? ""),
        feePerSessionCents: Math.max(0, Math.trunc(Number(s.feePerSessionCents ?? 0))),
        sessionDurationMin: Math.max(1, Math.trunc(Number(s.sessionDurationMin ?? 60))),
        active: Boolean(s.active ?? true),
      })),
    [rawStudents],
  );

  const slots: SlotDoc[] = useMemo(
    () =>
      rawSlots.map((s: any) => {
        const dayValue = String(s.day ?? "");
        const weekdayRaw = Number(s.weekday);
        const fallbackWeekday = (dayValue in DAY_TO_WEEKDAY)
          ? DAY_TO_WEEKDAY[dayValue as (typeof DAYS)[number]]
          : 0;
        const weekday = Number.isFinite(weekdayRaw) ? weekdayRaw : fallbackWeekday;
        const start = String(s.startTime ?? "00:00");
        const duration = Number(s.duration ?? s.durationMin ?? 60);
        const end = String(s.endTime ?? "");
        const endLabel = end || (() => {
          const [hh, mm] = start.split(":").map((n) => Number(n));
          const mins = (hh || 0) * 60 + (mm || 0) + duration;
          const endH = String(Math.floor(mins / 60)).padStart(2, "0");
          const endM = String(mins % 60).padStart(2, "0");
          return `${endH}:${endM}`;
        })();

        const studentsList: SlotStudent[] = Array.isArray(s.students)
          ? s.students
              .map((st: any) => ({ id: String(st?.id ?? ""), name: String(st?.name ?? "Student") }))
              .filter((st: SlotStudent) => st.id)
          : [];

        return {
          id: String(s.id),
          dayLabel: dayValue || String(DAYS[weekday] ?? "Sunday"),
          weekday,
          startTime: start,
          endTime: endLabel,
          duration,
          students: studentsList,
          isLocked: Boolean(s.isLocked ?? true),
        };
      }),
    [rawSlots],
  );

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) ?? null,
    [selectedStudentId, students],
  );

  const selectedSessions = useMemo(
    () => (selectedStudentId ? sessions.filter((s) => s.studentId === selectedStudentId) : []),
    [selectedStudentId, sessions],
  );
  const selectedPayments = useMemo(
    () => (selectedStudentId ? payments.filter((p) => p.studentId === selectedStudentId) : []),
    [payments, selectedStudentId],
  );

  const selectedBalance = useMemo(
    () => computeStudentBalance({ sessions: selectedSessions, payments: selectedPayments }),
    [selectedPayments, selectedSessions],
  );

  const selectedPaymentCoverage = useMemo(
    () => allocateVerifiedPaymentsOldestFirst({ sessions: selectedSessions, payments: selectedPayments }),
    [selectedPayments, selectedSessions],
  );

  const selectedSessionsPrepaidCoverage = useMemo(() => {
    const scheduledUpcoming = selectedSessions
      .filter(
        (session) =>
          session.status === "scheduled" &&
          (session.startAt ?? 0) > Date.now() &&
          Math.max(0, Number(session.feePerSessionCents ?? 0)) > 0,
      )
      .sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0));

    let remainingCredit = selectedPaymentCoverage.remainingCreditCents;
    const coveredIds = new Set<string>(selectedPaymentCoverage.fullyPaidSessionIds);

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
  }, [selectedPaymentCoverage, selectedSessions]);

  const selectedUpcomingPrepaid = useMemo(() => {
    const nowMs = Date.now();
    const scheduledUpcoming = selectedSessions
      .filter(
        (session) =>
          session.status === "scheduled" &&
          (session.startAt ?? 0) > nowMs &&
          Math.max(0, Number(session.feePerSessionCents ?? 0)) > 0,
      )
      .sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0));

    const fullyPaid = scheduledUpcoming.filter((session) =>
      selectedSessionsPrepaidCoverage.has(session.id),
    );

    return {
      paidCount: fullyPaid.length,
      paidCents: fullyPaid.reduce((sum, session) => sum + Math.max(0, Number(session.feePerSessionCents ?? 0)), 0),
    };
  }, [selectedSessionsPrepaidCoverage, selectedSessions]);

  const selectedAttendance = useMemo(
    () => {
      return [...selectedSessions].sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0)).slice(0, 30);
    },
    [selectedSessions],
  );

  const selectedMissedSummary = useMemo(() => {
    const missedSessions = selectedSessions.filter((s) => MISSED_STATUSES.has(s.status));
    const tutorCanceledCount = selectedSessions.filter((s) => s.status === "tutor_cancel").length;
    const earlyCancelCount = missedSessions.filter((s) => s.status === "early_cancel").length;
    const lateCancelCount = missedSessions.filter((s) => s.status === "late_cancel").length;
    const noShowCount = missedSessions.filter((s) => s.status === "no_show").length;
    const missedRevenueCents = missedSessions.reduce((sum, s) => {
      const expected = Math.max(0, Number(s.feePerSessionCents ?? 0));
      const charged = Math.max(0, Number(s.chargeCents ?? 0));
      return sum + Math.max(0, expected - charged);
    }, 0);
    return {
      totalMissed: missedSessions.length,
      tutorCanceledCount,
      earlyCancelCount,
      lateCancelCount,
      noShowCount,
      missedRevenueCents,
    };
  }, [selectedSessions]);

  const rescheduleQuery = useMemo(
    () => (selectedStudentId ? qRescheduleForStudent(selectedStudentId) : null),
    [selectedStudentId],
  );
  const { data: selectedReschedules } = useFirestoreQuery<Record<string, unknown>>(rescheduleQuery);

  const currentSlotIdsForSelected = useMemo(() => {
    if (!selectedStudentId) return [];
    return slots
      .filter((slot) => slot.students.some((st) => st.id === selectedStudentId))
      .map((slot) => slot.id);
  }, [selectedStudentId, slots]);

  useEffect(() => {
    if (!selectedStudent) return;
    setEditFullName(selectedStudent.fullName);
    setEditParentName(selectedStudent.parentName);
    setEditContactNumber(selectedStudent.contactNumber);
    setEditEmail(selectedStudent.email);
    setEditFeeLkr((selectedStudent.feePerSessionCents / 100).toFixed(2));
    setEditSessionDuration(String(selectedStudent.sessionDurationMin));
    setEditAssignedSlotIds(currentSlotIdsForSelected);
  }, [currentSlotIdsForSelected, selectedStudent]);

  async function syncStudentSlots(args: {
    studentId: string;
    studentName: string;
    nextSlotIds: string[];
    feePerSessionCents: number;
  }) {
    const nextSet = new Set(args.nextSlotIds);
    const slotById = new Map(slots.map((slot) => [slot.id, slot]));

    async function createUpcomingSessionsForSlot(slot: SlotDoc) {
      const feePerSessionCents = Math.max(0, Math.trunc(args.feePerSessionCents));
      const today = new Date();
      for (let i = 0; i < 35; i++) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
        if (d.getDay() !== slot.weekday) continue;

        const startAt = combineDateTimeMs(d, slot.startTime);
        const endAt = startAt + slot.duration * 60_000;
        const sessionId = `${slot.id}_${args.studentId}_${yyyymmdd(d)}`;
        const sessionRef = doc(db, col.sessions(), sessionId);
        const existing = await getDoc(sessionRef);
        if (existing.exists()) continue;

        await setDoc(sessionRef, {
          studentId: args.studentId,
          slotId: slot.id,
          startAt,
          endAt,
          status: "scheduled",
          feePerSessionCents,
          chargeCents: computeChargeCents({ feePerSessionCents, status: "scheduled" }),
          createdFrom: "timetable",
        });
      }
    }

    async function deleteUpcomingSessionsForSlot(slotId: string) {
      const today = new Date();
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
      const q = query(collection(db, col.sessions()), where("slotId", "==", slotId));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        const data = d.data() as { studentId?: unknown; startAt?: unknown };
        const sid = String(data.studentId ?? "");
        const startAt = Number(data.startAt ?? 0);
        if (sid !== args.studentId) continue;
        if (!Number.isFinite(startAt) || startAt < todayStart) continue;
        await deleteDoc(doc(db, col.sessions(), d.id));
      }
    }

    for (const slot of slots) {
      const hasStudent = slot.students.some((st) => st.id === args.studentId);
      const shouldHave = nextSet.has(slot.id);
      if (hasStudent === shouldHave) {
        continue;
      }

      if (slot.isLocked) {
        await updateDoc(doc(db, col.timetableSlots(), slot.id), { isLocked: false });
      }

      const studentsNext = shouldHave
        ? [...slot.students, { id: args.studentId, name: args.studentName }]
        : slot.students.filter((st) => st.id !== args.studentId);

      await updateDoc(doc(db, col.timetableSlots(), slot.id), {
        students: studentsNext,
        studentId: studentsNext[0]?.id ?? null,
      });

      if (shouldHave) {
        await createUpcomingSessionsForSlot(slot);
      } else {
        await deleteUpcomingSessionsForSlot(slot.id);
      }

      if (slot.isLocked) {
        await updateDoc(doc(db, col.timetableSlots(), slot.id), { isLocked: true });
      }
    }

    // Self-heal previously assigned slots that were missing sessions.
    for (const slotId of args.nextSlotIds) {
      const slot = slotById.get(slotId);
      if (!slot) continue;
      await createUpcomingSessionsForSlot(slot);
    }
  }

  async function onCreateStudent(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    setActionSuccess(null);

    const emailTrim = email.trim().toLowerCase();
    const feePerSessionCents = Math.round(Number(feeLkr) * 100);
    const duration = Math.trunc(Number(sessionDurationMin));
    if (!fullName.trim()) {
      setActionError("Full name is required.");
      return;
    }
    if (!emailTrim.includes("@")) {
      setActionError("Valid email is required.");
      return;
    }
    if (!Number.isFinite(feePerSessionCents) || feePerSessionCents <= 0) {
      setActionError("Fee per session must be greater than 0.");
      return;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      setActionError("Session duration must be greater than 0.");
      return;
    }

    setCreating(true);
    try {
      const tempPassword = randomPassword();
      const authUser = await createAuthUserWithEmailPassword({
        email: emailTrim,
        password: tempPassword,
      });

      const studentRef = doc(collection(db, col.students()));
      await setDoc(studentRef, {
        fullName: fullName.trim(),
        parentName: parentName.trim(),
        contactNumber: contactNumber.trim(),
        email: emailTrim,
        authUid: authUser.uid,
        feePerSessionCents,
        sessionDurationMin: duration,
        sessionType: "individual",
        active: true,
        createdAt: Date.now(),
      });

      await setDoc(doc(db, col.users(), authUser.uid), {
        role: "student",
        studentId: studentRef.id,
      });

      await syncStudentSlots({
        studentId: studentRef.id,
        studentName: fullName.trim(),
        nextSlotIds: assignedSlotIds,
        feePerSessionCents,
      });

      setActionSuccess(
        `Student created. Email: ${emailTrim} | Temporary password: ${tempPassword}`,
      );
      setFullName("");
      setParentName("");
      setContactNumber("");
      setEmail("");
      setFeeLkr("5000");
      setSessionDurationMin("180");
      setAssignedSlotIds([]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to create student.");
    } finally {
      setCreating(false);
    }
  }

  async function onSaveStudent() {
    if (!selectedStudent) return;
    setActionError(null);
    setActionSuccess(null);

    const feePerSessionCents = Math.round(Number(editFeeLkr) * 100);
    const duration = Math.trunc(Number(editSessionDuration));
    if (!editFullName.trim()) {
      setActionError("Full name is required.");
      return;
    }
    if (editEmail.trim() && !editEmail.trim().includes("@")) {
      setActionError("Invalid email format.");
      return;
    }
    if (!Number.isFinite(feePerSessionCents) || feePerSessionCents <= 0) {
      setActionError("Fee per session must be greater than 0.");
      return;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      setActionError("Session duration must be greater than 0.");
      return;
    }

    setSaving(true);
    try {
      await updateDoc(doc(db, col.students(), selectedStudent.id), {
        fullName: editFullName.trim(),
        parentName: editParentName.trim(),
        contactNumber: editContactNumber.trim(),
        email: editEmail.trim().toLowerCase(),
        feePerSessionCents,
        sessionDurationMin: duration,
      });

      await syncStudentSlots({
        studentId: selectedStudent.id,
        studentName: editFullName.trim(),
        nextSlotIds: editAssignedSlotIds,
        feePerSessionCents,
      });

      setActionSuccess("Student updated successfully.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update student.");
    } finally {
      setSaving(false);
    }
  }

  async function onDeactivateStudent() {
    if (!selectedStudent) return;
    if (!window.confirm("Deactivate this student? History will be preserved.")) return;

    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await updateDoc(doc(db, col.students(), selectedStudent.id), {
        active: false,
        deactivatedAt: Date.now(),
      });
      setActionSuccess("Student deactivated.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to deactivate student.");
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteStudentRecord() {
    if (!selectedStudent) return;
    if (
      !window.confirm(
        "Delete this student record only? Attendance and payments remain in history but this profile will be removed.",
      )
    ) {
      return;
    }

    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await syncStudentSlots({
        studentId: selectedStudent.id,
        studentName: selectedStudent.fullName,
        nextSlotIds: [],
        feePerSessionCents: selectedStudent.feePerSessionCents,
      });
      if (selectedStudent.authUid) {
        await deleteDoc(doc(db, col.users(), selectedStudent.authUid));
      }
      await deleteDoc(doc(db, col.students(), selectedStudent.id));
      setSelectedStudentId("");
      setActionSuccess("Student record deleted.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete student.");
    } finally {
      setSaving(false);
    }
  }

  async function openPaymentSlip(payment: Payment) {
    setActionError(null);
    setActionSuccess(null);
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
        setActionError("No slip file is attached to this payment.");
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
      setActionError(err instanceof Error ? err.message : "Failed to open slip.");
    } finally {
      setOpeningSlipPaymentId((current) => (current === payment.id ? null : current));
    }
  }

  async function onDeletePayment(payment: Payment) {
    setActionError(null);
    setActionSuccess(null);
    const proceed = window.confirm("Delete this payment record? This cannot be undone.");
    if (!proceed) return;
    try {
      await deleteDoc(doc(db, col.payments(), payment.id));
      setActionSuccess("Payment record deleted.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete payment.");
    }
  }

  function exportStudentReport() {
    if (!selectedStudent) {
      setActionError("Select a student before exporting a report.");
      return;
    }
    try {
      exportStudentComprehensiveReport({
        student: selectedStudent,
        month: reportMonth,
        sessions: selectedSessions,
        payments: selectedPayments,
      });
      setActionSuccess(`Report for ${reportMonth} exported successfully.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to export report.");
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

      {actionError ? <div className="text-sm text-red-300">{actionError}</div> : null}
      {actionSuccess ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {actionSuccess}
        </div>
      ) : null}

      <div className="card p-6">
        <div className="font-semibold">Add student</div>
        <form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={onCreateStudent}>
          <div className="space-y-1">
            <div className="label">Full name</div>
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <div className="label">Parent name (optional)</div>
            <input className="input" value={parentName} onChange={(e) => setParentName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <div className="label">Contact number</div>
            <input className="input" value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} />
          </div>
          <div className="space-y-1">
            <div className="label">Email (login)</div>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <div className="label">Fee per session (LKR)</div>
            <input className="input" value={feeLkr} onChange={(e) => setFeeLkr(e.target.value)} placeholder="5000" inputMode="decimal" required />
          </div>
          <div className="space-y-1">
            <div className="label">Session duration (min)</div>
            <input className="input" value={sessionDurationMin} onChange={(e) => setSessionDurationMin(e.target.value)} inputMode="numeric" required />
          </div>

          <div className="space-y-1 md:col-span-3">
            <div className="label">Assign schedule slots</div>
            <div className="max-h-48 space-y-1 overflow-auto rounded-lg border border-[rgb(var(--border))] p-2">
              {slots.map((slot) => (
                <label key={slot.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={assignedSlotIds.includes(slot.id)}
                    onChange={(e) => {
                      setAssignedSlotIds((prev) =>
                        e.target.checked ? [...prev, slot.id] : prev.filter((x) => x !== slot.id),
                      );
                    }}
                  />
                  <span>
                    {slot.dayLabel} {slot.startTime}-{slot.endTime}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="md:col-span-3 flex justify-end">
            <button className="btn btn-primary" disabled={creating}>
              {creating ? "Creating..." : "Create student + login"}
            </button>
          </div>
        </form>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="card p-6">
          <div className="font-semibold">Students</div>
          <div className="mt-3 space-y-2">
            {students.map((s) => (
              <button
                key={s.id}
                className={`w-full rounded-lg border p-3 text-left ${
                  selectedStudentId === s.id
                    ? "border-[rgb(var(--brand))]"
                    : "border-[rgb(var(--border))]"
                }`}
                onClick={() => setSelectedStudentId(s.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium">{s.fullName}</div>
                  <div className={`text-xs ${s.active ? "text-emerald-400" : "text-red-300"}`}>
                    {s.active ? "Active" : "Inactive"}
                  </div>
                </div>
                <div className="text-xs text-[rgb(var(--muted))]">{s.email || "No email"}</div>
              </button>
            ))}
            {students.length === 0 ? (
              <div className="text-sm text-[rgb(var(--muted))]">No students yet.</div>
            ) : null}
          </div>
        </div>

        <div className="card p-6">
          <div className="font-semibold">Edit selected student</div>
          {!selectedStudent ? (
            <div className="mt-3 text-sm text-[rgb(var(--muted))]">Select a student to edit profile and schedule.</div>
          ) : (
            <div className="mt-4 space-y-3">
              <input className="input" value={editFullName} onChange={(e) => setEditFullName(e.target.value)} placeholder="Full name" />
              <input className="input" value={editParentName} onChange={(e) => setEditParentName(e.target.value)} placeholder="Parent name" />
              <input className="input" value={editContactNumber} onChange={(e) => setEditContactNumber(e.target.value)} placeholder="Contact number" />
              <input className="input" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Email" />
              <div className="grid grid-cols-2 gap-2">
                <input className="input" value={editFeeLkr} onChange={(e) => setEditFeeLkr(e.target.value)} placeholder="5000" inputMode="decimal" />
                <input className="input" value={editSessionDuration} onChange={(e) => setEditSessionDuration(e.target.value)} placeholder="Duration min" inputMode="numeric" />
              </div>
              <div className="max-h-48 space-y-1 overflow-auto rounded-lg border border-[rgb(var(--border))] p-2">
                {slots.map((slot) => (
                  <label key={slot.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={editAssignedSlotIds.includes(slot.id)}
                      onChange={(e) => {
                        setEditAssignedSlotIds((prev) =>
                          e.target.checked ? [...prev, slot.id] : prev.filter((x) => x !== slot.id),
                        );
                      }}
                    />
                    <span>
                      {slot.dayLabel} {slot.startTime}-{slot.endTime}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-end justify-end gap-2">
                <label className="flex flex-col gap-1 text-xs text-[rgb(var(--muted))]">
                  Report month
                  <input
                    type="month"
                    className="input w-40"
                    value={reportMonth}
                    onChange={(e) => setReportMonth(e.target.value)}
                  />
                </label>
                <button className="btn btn-primary" onClick={onSaveStudent} disabled={saving}>
                  Save
                </button>
                <button className="btn btn-primary" onClick={exportStudentReport} disabled={saving}>
                  Export Monthly Report
                </button>
                <button className="btn btn-ghost" onClick={onDeactivateStudent} disabled={saving}>
                  Deactivate
                </button>
                <button className="btn btn-ghost" onClick={onDeleteStudentRecord} disabled={saving}>
                  Delete record
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card p-6">
        <div className="font-semibold">Student profile</div>
        {!selectedStudent ? (
          <div className="mt-2 text-sm text-[rgb(var(--muted))]">Select a student to view profile.</div>
        ) : (
          <div className="mt-4 space-y-5">
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
              <div className="rounded-lg border border-[rgb(var(--border))] p-3">
                <div className="text-xs text-[rgb(var(--muted))]">Total charged</div>
                <div className="text-lg font-semibold">{formatMoneyLKR(selectedBalance.totalChargedCents)}</div>
              </div>
              <div className="rounded-lg border border-[rgb(var(--border))] p-3">
                <div className="text-xs text-[rgb(var(--muted))]">Total paid</div>
                <div className="text-lg font-semibold">{formatMoneyLKR(selectedBalance.totalPaidCents)}</div>
              </div>
              <div className="rounded-lg border border-[rgb(var(--border))] p-3">
                <div className="text-xs text-[rgb(var(--muted))]">Remaining balance</div>
                <div className="text-lg font-semibold">{formatMoneyLKR(selectedBalance.remainingCents)}</div>
              </div>
              <div className="rounded-lg border border-[rgb(var(--border))] bg-emerald-500/10 p-3">
                <div className="text-xs text-[rgb(var(--muted))]">Prepaid for upcoming</div>
                <div className="text-lg font-semibold">{formatMoneyLKR(selectedUpcomingPrepaid.paidCents)}</div>
                <div className="text-[11px] text-[rgb(var(--muted))]">
                  {selectedUpcomingPrepaid.paidCount} scheduled classes covered
                </div>
              </div>
              <div className="rounded-lg border border-[rgb(var(--border))] bg-indigo-500/10 p-3">
                <div className="text-xs text-[rgb(var(--muted))]">Advance balance</div>
                <div className="text-lg font-semibold">
                  {formatMoneyLKR(selectedPaymentCoverage.remainingCreditCents)}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3">
              <div className="text-sm font-semibold text-rose-200">Missed classes and missed revenue</div>
              <div className="mt-2 grid gap-2 text-sm md:grid-cols-6">
                <div>
                  <div className="text-xs text-rose-100/80">Total missed</div>
                  <div className="font-semibold text-rose-100">{selectedMissedSummary.totalMissed}</div>
                </div>
                <div>
                  <div className="text-xs text-indigo-100/80">Tutor canceled</div>
                  <div className="font-semibold text-indigo-100">{selectedMissedSummary.tutorCanceledCount}</div>
                </div>
                <div>
                  <div className="text-xs text-rose-100/80">Early cancel</div>
                  <div className="font-semibold text-rose-100">{selectedMissedSummary.earlyCancelCount}</div>
                </div>
                <div>
                  <div className="text-xs text-rose-100/80">Late cancel</div>
                  <div className="font-semibold text-rose-100">{selectedMissedSummary.lateCancelCount}</div>
                </div>
                <div>
                  <div className="text-xs text-rose-100/80">No show</div>
                  <div className="font-semibold text-rose-100">{selectedMissedSummary.noShowCount}</div>
                </div>
                <div>
                  <div className="text-xs text-rose-100/80">Missed revenue</div>
                  <div className="font-semibold text-rose-100">{formatMoneyLKR(selectedMissedSummary.missedRevenueCents)}</div>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-2 font-medium">Attendance history</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[rgb(var(--muted))]">
                    <tr className="border-b border-[rgb(var(--border))]">
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3 text-right">Charge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedAttendance.map((s) => (
                      <tr key={s.id} className={`border-b border-[rgb(var(--border))] ${MISSED_STATUSES.has(s.status) ? "bg-rose-500/10" : ""}`}>
                        <td className="py-2 pr-3">{new Date(s.startAt).toLocaleString()}</td>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <span className={statusPillClass(s.status)}>
                              {s.status.replaceAll("_", " ")}
                              {MISSED_STATUSES.has(s.status) ? " (MISSED)" : ""}
                            </span>
                            {s.status === "scheduled" &&
                            selectedSessionsPrepaidCoverage.has(s.id) &&
                            Math.max(0, Number(s.feePerSessionCents ?? 0)) > 0 ? (
                              <span className="status-pill status-attended">already paid</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-right">{formatMoneyLKR(s.chargeCents)}</td>
                      </tr>
                    ))}
                    {selectedAttendance.length === 0 ? (
                      <tr>
                        <td className="py-4 text-[rgb(var(--muted))]" colSpan={3}>
                          No attendance records.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="mb-2 font-medium">Payment history</div>
              <div className="overflow-x-auto">
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
                    {selectedPayments
                      .slice()
                      .sort((a, b) => b.paidAt - a.paidAt)
                      .slice(0, 30)
                      .map((p) => (
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
                            <button className="btn btn-ghost" onClick={() => void onDeletePayment(p)}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    {selectedPayments.length === 0 ? (
                      <tr>
                        <td className="py-4 text-[rgb(var(--muted))]" colSpan={8}>
                          No payment records.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="mb-2 font-medium">Reschedule requests</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[rgb(var(--muted))]">
                    <tr className="border-b border-[rgb(var(--border))]">
                      <th className="py-2 pr-3">Requested at</th>
                      <th className="py-2 pr-3">From session</th>
                      <th className="py-2 pr-3">Requested start</th>
                      <th className="py-2 pr-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedReschedules.map((r: any) => (
                      <tr key={String(r.id)} className="border-b border-[rgb(var(--border))]">
                        <td className="py-2 pr-3">
                          {r.createdAt ? new Date(Number(r.createdAt)).toLocaleString() : "-"}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">{String(r.fromSessionId ?? "")}</td>
                        <td className="py-2 pr-3">
                          {r.requestedStartAt
                            ? new Date(Number(r.requestedStartAt)).toLocaleString()
                            : "-"}
                        </td>
                        <td className="py-2 pr-3">{String(r.status ?? "requested")}</td>
                      </tr>
                    ))}
                    {selectedReschedules.length === 0 ? (
                      <tr>
                        <td className="py-4 text-[rgb(var(--muted))]" colSpan={4}>
                          No reschedule requests.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
