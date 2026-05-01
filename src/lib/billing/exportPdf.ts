import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { allocateVerifiedPaymentsOldestFirst } from "@/lib/billing/rollup";
import { computeMonthlySummary, monthKeyFromMs } from "@/lib/billing/monthly";
import type { MonthlySummary, Payment, Session, Student } from "@/lib/model/types";

type MonthlyReportStudent = Pick<
  Student,
  "id" | "fullName" | "email" | "parentName" | "contactNumber" | "sessionDurationMin" | "feePerSessionCents"
>;

type WeeklyReportStudent = MonthlyReportStudent;

type WeeklyReportPhase = "start" | "end";

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

function formatWeekDay(ms: number) {
  return new Intl.DateTimeFormat("en-LK", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

function parseDateInput(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map((part) => Number(part));
  return new Date(year || 0, (month || 1) - 1, day || 1);
}

function getWeekRange(dateValue: string) {
  const anchor = parseDateInput(dateValue);
  const day = anchor.getDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(anchor);
  start.setDate(anchor.getDate() + offsetToMonday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { startMs: start.getTime(), endMs: end.getTime(), start, end };
}

function getDateRange(dateStart: string, dateEnd: string) {
  const start = parseDateInput(dateStart);
  const end = parseDateInput(dateEnd);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return {
    startMs: start.getTime(),
    endMs: end.getTime() + 24 * 60 * 60 * 1000,
    start,
    end,
  };
}

function getClassKind(session: Session) {
  if (session.createdFrom === "makeup") return "Make-up";
  if (session.createdFrom === "manual") return "Extra";
  if (session.createdFrom === "reschedule") return "Rescheduled";
  return "Regular";
}

function getSessionNote(session: Session, sessionMap: Map<string, Session>) {
  const original = session.createdFromSessionId ? sessionMap.get(session.createdFromSessionId) : null;

  if (session.createdFrom === "makeup") {
    return original ? `Make-up for ${formatWeekDay(original.startAt)}` : "Make-up class";
  }

  if (session.coverupStatus === "scheduled") {
    return session.coverupScheduledFor ? `Scheduled to be covered on ${formatWeekDay(session.coverupScheduledFor)}` : "Cover-up scheduled";
  }

  if (session.coverupStatus === "completed") {
    return session.coverupCompletedAt ? `Covered on ${formatWeekDay(session.coverupCompletedAt)}` : "Covered";
  }

  if (session.status === "tutor_cancel") {
    return "Tutor canceled";
  }

  if (["early_cancel", "late_cancel", "no_show"].includes(session.status)) {
    return `Missed on ${formatWeekDay(session.startAt)}`;
  }

  return original ? `Related to ${formatWeekDay(original.startAt)}` : "Scheduled class";
}

function getPhaseTitle(phase: WeeklyReportPhase) {
  return phase === "start" ? "Weekly Schedule Report" : "Weekly Attendance Report";
}

function getPhaseSubtitle(phase: WeeklyReportPhase) {
  return phase === "start"
    ? "Planned schedule for the week, including make-up and extra classes."
    : "End-of-week summary with attended, cancelled, and make-up coverage status.";
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

export function exportStudentWeeklyReport(args: {
  student: WeeklyReportStudent;
  weekDate: string;
  sessions: Session[];
  phase: WeeklyReportPhase;
}) {
  const doc = new jsPDF();
  const { startMs, endMs, start, end } = getWeekRange(args.weekDate);
  const weekLabel = `${new Intl.DateTimeFormat("en-LK", { dateStyle: "medium" }).format(start)} - ${
    new Intl.DateTimeFormat("en-LK", { dateStyle: "medium" }).format(new Date(endMs - 1))
  }`;

  const weekSessions = args.sessions
    .filter((session) => session.startAt >= startMs && session.startAt < endMs)
    .sort((a, b) => a.startAt - b.startAt);

  const sessionMap = new Map(args.sessions.map((session) => [session.id, session] as const));
  const scheduledCount = weekSessions.filter((session) => session.status === "scheduled").length;
  const attendedCount = weekSessions.filter((session) => session.status === "attended").length;
  const cancelledCount = weekSessions.filter((session) => ["early_cancel", "late_cancel", "no_show"].includes(session.status)).length;
  const tutorCanceledCount = weekSessions.filter((session) => session.status === "tutor_cancel").length;
  const makeupCount = weekSessions.filter((session) => session.createdFrom === "makeup").length;
  const extraCount = weekSessions.filter((session) => session.createdFrom === "manual").length;
  const coverupScheduledCount = weekSessions.filter((session) => session.coverupStatus === "scheduled").length;
  const coverupCompletedCount = weekSessions.filter((session) => session.coverupStatus === "completed").length;

  const title = getPhaseTitle(args.phase);
  const subtitle = getPhaseSubtitle(args.phase);
  const accent: [number, number, number] = args.phase === "start" ? [14, 116, 144] : [21, 128, 61];

  doc.setFillColor(...accent);
  doc.rect(0, 0, 210, 34, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(title, 14, 14);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(subtitle, 14, 21, { maxWidth: 182 });

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(args.student.fullName, 14, 45);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Week: ${weekLabel}`, 14, 52);
  doc.text(`Contact: ${args.student.contactNumber || "-"}`, 14, 58);
  doc.text(`Parent: ${args.student.parentName || "-"}`, 14, 64);
  doc.text(`Session duration: ${args.student.sessionDurationMin} minutes`, 14, 70);
  doc.text(`Fee/session: ${money(args.student.feePerSessionCents)}`, 14, 76);

  const metricY = 84;
  const cards = args.phase === "start"
    ? [
        ["Planned classes", String(weekSessions.length)],
        ["Make-ups", String(makeupCount)],
        ["Extra classes", String(extraCount)],
        ["Cover-ups scheduled", String(coverupScheduledCount)],
      ]
    : [
        ["Attended", String(attendedCount)],
        ["Cancelled", String(cancelledCount)],
        ["Tutor cancelled", String(tutorCanceledCount)],
        ["Cover-ups completed", String(coverupCompletedCount)],
      ];

  cards.forEach(([label, value], index) => {
    const x = 14 + (index % 2) * 94;
    const y = metricY + Math.floor(index / 2) * 18;
    doc.setDrawColor(...accent);
    doc.setFillColor(245, 247, 250);
    doc.roundedRect(x, y, 88, 14, 2, 2, "FD");
    doc.setFontSize(8);
    doc.setTextColor(85, 85, 85);
    doc.text(label, x + 3, y + 5);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...accent);
    doc.text(value, x + 3, y + 11);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
  });

  const rows = weekSessions.map((session) => [
    formatWeekDay(session.startAt),
    getClassKind(session),
    session.status.replaceAll("_", " "),
    getSessionNote(session, sessionMap),
  ]);

  autoTable(doc, {
    startY: metricY + 40,
    head: [["Date & Time", "Type", "Status", "Notes"]],
    body: rows,
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: accent, textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 42 },
      1: { cellWidth: 28 },
      2: { cellWidth: 34 },
      3: { cellWidth: 76 },
    },
  });

  const yAfterTable = Number((doc as any).lastAutoTable?.finalY ?? metricY + 40) + 10;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("WhatsApp ready summary", 14, yAfterTable);
  doc.setFont("helvetica", "normal");
  const summaryLines =
    args.phase === "start"
      ? [
          `Planned sessions: ${weekSessions.length}`,
          `Make-ups / extra classes: ${makeupCount + extraCount}`,
          `Cover-ups already scheduled: ${coverupScheduledCount}`,
        ]
      : [
          `Attended: ${attendedCount}`,
          `Cancelled: ${cancelledCount}`,
          `Tutor cancelled: ${tutorCanceledCount}`,
          `Cover-ups completed: ${coverupCompletedCount}`,
        ];
  summaryLines.forEach((line, index) => {
    doc.text(`• ${line}`, 14, yAfterTable + 6 + index * 5);
  });

  const generatedOn = new Intl.DateTimeFormat("en-LK", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`Generated on ${generatedOn}`, 14, 285);
  doc.text("Share this report directly in WhatsApp.", 130, 285);

  const safeName = args.student.fullName.replace(/[^\w.-]+/g, "_");
  const suffix = args.phase === "start" ? "week_start" : "week_end";
  doc.save(`${safeName}_${suffix}_report.pdf`);
}

export function exportTimetableWeeklyReport(args: {
  startDate: string;
  endDate: string;
  sessions: Session[];
  studentsById: Map<string, Pick<Student, "fullName">>;
}) {
  const doc = new jsPDF();
  const { startMs, endMs, start, end } = getDateRange(args.startDate, args.endDate);
  const rangeLabel = `${new Intl.DateTimeFormat("en-LK", { dateStyle: "medium" }).format(start)} - ${
    new Intl.DateTimeFormat("en-LK", { dateStyle: "medium" }).format(end)
  }`;

  const weekSessions = args.sessions
    .filter((session) => session.startAt >= startMs && session.startAt < endMs)
    .sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt || a.studentId.localeCompare(b.studentId));

  const sessionMap = new Map(args.sessions.map((session) => [session.id, session] as const));
  const regularCount = weekSessions.filter((session) => session.createdFrom === "timetable").length;
  const makeupCount = weekSessions.filter((session) => session.createdFrom === "makeup").length;
  const extraCount = weekSessions.filter((session) => session.createdFrom === "manual").length;
  const scheduledCount = weekSessions.filter((session) => session.status === "scheduled").length;
  const attendedCount = weekSessions.filter((session) => session.status === "attended").length;
  const cancelledCount = weekSessions.filter((session) => ["early_cancel", "late_cancel", "no_show"].includes(session.status)).length;
  const tutorCanceledCount = weekSessions.filter((session) => session.status === "tutor_cancel").length;
  const coverupScheduledCount = weekSessions.filter((session) => session.coverupStatus === "scheduled").length;
  const coverupCompletedCount = weekSessions.filter((session) => session.coverupStatus === "completed").length;

    const title = "Timetable";
    const subtitle = `Timetable for the selected range (${rangeLabel}).`;
  const accent: [number, number, number] = [14, 116, 144];

  const titleLines = doc.splitTextToSize(title, 182) as string[];
  const subtitleLines = doc.splitTextToSize(subtitle, 182) as string[];
  const headerTextBottom = 14 + titleLines.length * 6 + subtitleLines.length * 5;
  const summaryTop = Math.max(56, headerTextBottom + 4);

  doc.setFillColor(...accent);
  doc.rect(0, 0, 210, Math.max(52, headerTextBottom + 8), "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(titleLines, 14, 14);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(subtitleLines, 14, 14 + titleLines.length * 6 + 2);
  doc.setFontSize(9);
  doc.text(`Range: ${rangeLabel}`, 14, headerTextBottom + 2);

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Whole timetable summary", 14, summaryTop);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Total sessions: ${weekSessions.length}`, 14, summaryTop + 7);
  doc.text(`Regular timetable: ${regularCount}`, 14, summaryTop + 13);
  doc.text(`Make-up classes: ${makeupCount}`, 14, summaryTop + 19);
  doc.text(`Extra classes: ${extraCount}`, 14, summaryTop + 25);

  const cards = [
    ["Scheduled", String(scheduledCount)],
    ["Make-ups", String(makeupCount)],
    ["Extra", String(extraCount)],
    ["Cover-ups scheduled", String(coverupScheduledCount)],
  ];

  cards.forEach(([label, value], index) => {
    const x = 14 + (index % 2) * 94;
    const y = summaryTop + 33 + Math.floor(index / 2) * 18;
    doc.setDrawColor(...accent);
    doc.setFillColor(245, 247, 250);
    doc.roundedRect(x, y, 88, 14, 2, 2, "FD");
    doc.setFontSize(8);
    doc.setTextColor(85, 85, 85);
    doc.text(label, x + 3, y + 5);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...accent);
    doc.text(value, x + 3, y + 11);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
  });

  // Group sessions that share the same start/end and note into a single row with comma-separated students
  const groupMap = new Map<string, { startAt: number; endAt: number; classType: string; status: string; note: string; students: string[] }>();
  for (const session of weekSessions) {
    const original = session.createdFromSessionId ? sessionMap.get(session.createdFromSessionId) : null;
    const studentName = args.studentsById.get(session.studentId)?.fullName ?? session.studentId;
    const classType =
      session.createdFrom === "makeup"
        ? "Make-up"
        : session.createdFrom === "manual"
          ? "Extra"
          : session.createdFrom === "reschedule"
            ? "Rescheduled"
            : "Regular";

    const note = getSessionNote(session, sessionMap);

    const key = `${session.startAt}-${session.endAt}-${classType}-${session.status}-${note}`;
    const existing = groupMap.get(key);
    if (existing) {
      if (!existing.students.includes(studentName)) existing.students.push(studentName);
    } else {
      groupMap.set(key, {
        startAt: session.startAt,
        endAt: session.endAt,
        classType,
        status: session.status.replaceAll("_", " "),
        note,
        students: [studentName],
      });
    }
  }
  function formatTimeRange(start: number, end: number) {
    const fmt = new Intl.DateTimeFormat("en-LK", { hour: "numeric", minute: "2-digit" });
    const s = fmt.format(new Date(start));
    const e = fmt.format(new Date(end));
    return `${s} – ${e}`;
  }

  function dayLabel(ms: number) {
    return new Intl.DateTimeFormat("en-LK", { weekday: "long", day: "2-digit", month: "short" }).format(new Date(ms));
  }

  const rows = Array.from(groupMap.values()).map((g) => [
    `${dayLabel(g.startAt)}`,
    formatTimeRange(g.startAt, g.endAt),
    g.students.join(", "),
    g.classType,
    g.status,
    g.note,
  ]);

  autoTable(doc, {
    startY: summaryTop + 90,
    head: [["Day", "Time", "Students", "Type", "Status", "Notes"]],
    body: rows,
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: accent, textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 36 },
      2: { cellWidth: 46 },
      3: { cellWidth: 22 },
      4: { cellWidth: 22 },
      5: { cellWidth: 34 },
    },
  });

  const yAfterTable = Number((doc as any).lastAutoTable?.finalY ?? summaryTop + 90) + 10;

  const generatedOn = new Intl.DateTimeFormat("en-LK", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`Generated on ${generatedOn}`, 14, 285);

  doc.save(`Time Table for the week.pdf`);
}