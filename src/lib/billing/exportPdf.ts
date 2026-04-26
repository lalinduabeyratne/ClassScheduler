import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { allocateVerifiedPaymentsOldestFirst } from "@/lib/billing/rollup";
import { computeMonthlySummary, monthKeyFromMs } from "@/lib/billing/monthly";
import type { MonthlySummary, Payment, Session, Student } from "@/lib/model/types";

type MonthlyReportStudent = Pick<
  Student,
  "id" | "fullName" | "email" | "parentName" | "contactNumber" | "sessionDurationMin" | "feePerSessionCents"
>;

function money(cents: number) {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 2,
  }).format((cents ?? 0) / 100);
}

function formatDate(ms: number) {
  return new Intl.DateTimeFormat("en-LK", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ms));
}

function getAttendanceRating(
  totalSessions: number,
  attendedCount: number,
  missedCount: number,
  tutorCanceledCount: number,
): { rating: string; color: [number, number, number] } {
  if (totalSessions === 0) {
    return { rating: "No sessions yet", color: [128, 128, 128] };
  }

  // Calculate attendance percentage (exclude tutor-canceled from both numerator and denominator)
  const relevantSessions = totalSessions - tutorCanceledCount;
  if (relevantSessions === 0) {
    return { rating: "No relevant sessions (all tutor-canceled)", color: [128, 128, 128] };
  }

  const attendancePercent = (attendedCount / relevantSessions) * 100;

  if (attendancePercent >= 90) {
    return { rating: "Excellent - Keep it up!", color: [34, 197, 94] }; // green
  } else if (attendancePercent >= 75) {
    return { rating: "Good - Minor improvement needed", color: [59, 130, 246] }; // blue
  } else if (attendancePercent >= 60) {
    return { rating: "Needs Improvement - Work on consistency", color: [251, 146, 60] }; // orange
  } else {
    return { rating: "Poor - Immediate action required", color: [239, 68, 68] }; // red
  }
}

export function exportStudentMonthlyPdf(args: {
  studentName: string;
  month: string;
  summary: MonthlySummary;
  rows: Array<{ date: string; status: string; feeCents: number }>;
}) {
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text("Student Monthly Fee Report", 14, 16);
  doc.setFontSize(11);
  doc.text(`Student: ${args.studentName}`, 14, 26);
  doc.text(`Month: ${args.month}`, 14, 32);

  autoTable(doc, {
    startY: 40,
    head: [["Date", "Status", "Fee Charged"]],
    body: args.rows.map((r) => [r.date, r.status.replaceAll("_", " "), money(r.feeCents)]),
    styles: { fontSize: 10 },
  });

  const y = (doc as any).lastAutoTable?.finalY ? Number((doc as any).lastAutoTable.finalY) + 10 : 60;
  doc.text(`Opening Balance: ${money(args.summary.openingBalanceCents)}`, 14, y);
  doc.text(`Total Earned: ${money(args.summary.totalEarnedCents)}`, 14, y + 6);
  doc.text(`Total Paid: ${money(args.summary.totalPaidCents)}`, 14, y + 12);
  doc.text(`Closing Balance: ${money(args.summary.closingBalanceCents)}`, 14, y + 18);
  doc.text(`Closing Due: ${money(args.summary.dueCents)}`, 14, y + 24);
  doc.text(`Closing Credit: ${money(args.summary.creditCents)}`, 14, y + 30);

  const safeName = args.studentName.replace(/[^\w.-]+/g, "_");
  doc.save(`${safeName}_${args.month}_report.pdf`);
}

export function exportStudentComprehensiveReport(args: {
  student: MonthlyReportStudent;
  month: string;
  sessions: Session[];
  payments: Payment[];
}) {
  const doc = new jsPDF();
  let yPos = 10;
  const monthLabel = new Date(`${args.month}-01T00:00:00`).toLocaleDateString("en-LK", {
    month: "long",
    year: "numeric",
  });

  const monthSessions = args.sessions
    .filter((session) => monthKeyFromMs(session.startAt) === args.month)
    .sort((a, b) => a.startAt - b.startAt);
  const monthPayments = args.payments
    .filter((payment) => monthKeyFromMs(payment.paidAt) === args.month)
    .sort((a, b) => b.paidAt - a.paidAt);

  const monthlySummary = computeMonthlySummary({
    studentId: args.student.id,
    month: args.month,
    sessions: args.sessions,
    payments: args.payments,
  });

  const paymentCoverage = allocateVerifiedPaymentsOldestFirst({
    sessions: args.sessions,
    payments: args.payments,
  });

  const monthScheduledSessions = monthSessions.filter(
    (session) =>
      session.status === "scheduled" &&
      Math.max(0, Number(session.feePerSessionCents ?? 0)) > 0,
  );

  let advanceBalanceCents = paymentCoverage.remainingCreditCents;
  const prepaidMonthSessionIds = new Set<string>();
  for (const session of monthScheduledSessions) {
    const feeCents = Math.max(0, Number(session.feePerSessionCents ?? 0));
    if (advanceBalanceCents >= feeCents) {
      prepaidMonthSessionIds.add(session.id);
      advanceBalanceCents -= feeCents;
    }
  }

  const prepaidCents = monthScheduledSessions.reduce(
    (sum, session) => (prepaidMonthSessionIds.has(session.id) ? sum + Math.max(0, Number(session.feePerSessionCents ?? 0)) : sum),
    0,
  );

  // Title
  doc.setFontSize(18);
  doc.text("Student Monthly Progress Report", 14, (yPos += 8));
  doc.setLineWidth(0.5);
  doc.line(14, (yPos += 2), 196, yPos);

  // Student Info
  yPos += 8;
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Student Information", 14, (yPos += 6));
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(`Month: ${monthLabel}`, 14, (yPos += 5));
  doc.text(`Name: ${args.student.fullName}`, 14, (yPos += 5));
  doc.text(`Email: ${args.student.email || "-"}`, 14, (yPos += 4));
  doc.text(`Parent: ${args.student.parentName || "-"}`, 14, (yPos += 4));
  doc.text(`Contact: ${args.student.contactNumber || "-"}`, 14, (yPos += 4));
  doc.text(`Session Duration: ${args.student.sessionDurationMin} minutes`, 14, (yPos += 4));
  doc.text(`Fee per Session: ${money(args.student.feePerSessionCents)}`, 14, (yPos += 4));

  // Attendance Summary
  yPos += 6;
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Attendance Summary", 14, (yPos += 6));

  const completedSessions = monthSessions.filter((s) => s.status !== "scheduled");
  const attendedCount = completedSessions.filter((s) => s.status === "attended").length;
  const missedCount = completedSessions.filter(
    (s) => ["early_cancel", "late_cancel", "no_show"].includes(s.status),
  ).length;
  const tutorCanceledCount = completedSessions.filter((s) => s.status === "tutor_cancel").length;
  const totalCompleted = completedSessions.length;

  const { rating, color } = getAttendanceRating(totalCompleted, attendedCount, missedCount, tutorCanceledCount);

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(`Total Completed Classes: ${totalCompleted}`, 14, (yPos += 5));
  doc.text(`Attended: ${attendedCount}`, 14, (yPos += 4));
  doc.text(`Missed: ${missedCount}`, 14, (yPos += 4));
  doc.text(`Tutor Canceled: ${tutorCanceledCount}`, 14, (yPos += 4));

  doc.setFont("helvetica", "bold");
  doc.setTextColor(...color);
  yPos += 4;
  doc.text(`Assessment: ${rating}`, 14, (yPos += 4));
  doc.setTextColor(0, 0, 0);

  // Sessions in selected month
  if (monthSessions.length > 0) {
    yPos += 6;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(`${monthLabel} Classes`, 14, (yPos += 6));

    const monthData = monthSessions.slice(0, 15).map((s) => [
      formatDate(s.startAt),
      s.status.replaceAll("_", " "),
      `${args.student.sessionDurationMin} min`,
      money(args.student.feePerSessionCents),
    ]);

    autoTable(doc, {
      startY: (yPos += 4),
      head: [["Date & Time", "Status", "Duration", "Fee"]],
      body: monthData,
      styles: { fontSize: 9 },
      columnStyles: { 1: { halign: "center" }, 2: { halign: "center" }, 3: { halign: "right" } },
    });
    yPos = (doc as any).lastAutoTable?.finalY ?? yPos;
  }

  // Payment History
  if (monthPayments.length > 0) {
    yPos += 6;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(`${monthLabel} Payment History`, 14, (yPos += 6));

    const paymentData = monthPayments
      .slice(0, 15)
      .map((p) => [
        new Date(p.paidAt).toLocaleDateString(),
        money(p.amountCents),
        p.status.replaceAll("_", " "),
        (p.paymentType ?? "single").replaceAll("_", " "),
      ]);

    autoTable(doc, {
      startY: (yPos += 4),
      head: [["Date", "Amount", "Status", "Type"]],
      body: paymentData,
      styles: { fontSize: 9 },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "center" } },
    });
    yPos = (doc as any).lastAutoTable?.finalY ?? yPos;
  }

  // Payment Status
  yPos += 6;
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Payment Status", 14, (yPos += 6));

  const totalChargedCents = args.sessions.reduce((sum, s) => sum + (s.chargeCents ?? 0), 0);
  const totalPaidCents = args.payments
    .filter((p) => p.status === "verified")
    .reduce((sum, p) => sum + (p.amountCents ?? 0), 0);
  const dueAmountCents = Math.max(0, totalChargedCents - totalPaidCents);

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(`Total Charged: ${money(totalChargedCents)}`, 14, (yPos += 5));
  doc.text(`Total Paid: ${money(totalPaidCents)}`, 14, (yPos += 4));
  doc.text(`Amount Due: ${money(dueAmountCents)}`, 14, (yPos += 4));
  doc.text(`Prepaid in Month: ${money(prepaidCents)}`, 14, (yPos += 4));
  doc.text(`Advance Balance Remaining: ${money(advanceBalanceCents)}`, 14, (yPos += 4));

  // Footer
  const reportDate = new Intl.DateTimeFormat("en-LK", {
    dateStyle: "long",
  }).format(new Date());
  doc.setFontSize(9);
  doc.setTextColor(128, 128, 128);
  doc.text(`Report generated on ${reportDate}`, 14, 280);

  const safeName = args.student.fullName.replace(/[^\w.-]+/g, "_");
  doc.save(`${safeName}_${args.month}_monthly_report.pdf`);
}