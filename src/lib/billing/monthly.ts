import type { MonthlySummary, Payment, Session } from "@/lib/model/types";

export function monthKeyFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function computeMonthlySummary(args: {
  studentId: string;
  month: string;
  sessions: Session[];
  payments: Payment[];
}): MonthlySummary {
  const [yearPart, monthPart] = args.month.split("-");
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  const monthStart = Number.isFinite(year) && Number.isFinite(monthIndex)
    ? new Date(year, monthIndex, 1).getTime()
    : Number.NaN;
  const monthEnd = Number.isFinite(year) && Number.isFinite(monthIndex)
    ? new Date(year, monthIndex + 1, 1).getTime()
    : Number.NaN;

  const inSelectedMonth = (ms: number) => {
    if (Number.isFinite(monthStart) && Number.isFinite(monthEnd)) {
      return ms >= monthStart && ms < monthEnd;
    }
    return monthKeyFromMs(ms) === args.month;
  };

  const beforeSelectedMonth = (ms: number) => {
    if (Number.isFinite(monthStart)) {
      return ms < monthStart;
    }
    return false;
  };

  const studentSessionsAll = args.sessions.filter((s) => s.studentId === args.studentId);
  const studentPaymentsAllVerified = args.payments.filter(
    (p) => p.studentId === args.studentId && p.status === "verified",
  );

  const studentSessions = studentSessionsAll.filter((s) => inSelectedMonth(s.startAt));
  const studentPayments = studentPaymentsAllVerified.filter((p) => inSelectedMonth(p.paidAt));

  const earnedBeforeMonthCents = studentSessionsAll
    .filter((s) => beforeSelectedMonth(s.startAt))
    .reduce((sum, s) => sum + (s.chargeCents ?? 0), 0);
  const paidBeforeMonthCents = studentPaymentsAllVerified
    .filter((p) => beforeSelectedMonth(p.paidAt))
    .reduce((sum, p) => sum + (p.amountCents ?? 0), 0);
  const openingBalanceCents = earnedBeforeMonthCents - paidBeforeMonthCents;

  const totalEarnedCents = studentSessions.reduce((sum, s) => sum + (s.chargeCents ?? 0), 0);
  const totalPaidCents = studentPayments.reduce((sum, p) => sum + (p.amountCents ?? 0), 0);
  const closingBalanceCents = openingBalanceCents + totalEarnedCents - totalPaidCents;

  const totalSessions = studentSessions.length;
  const attendedCount = studentSessions.filter((s) => s.status === "attended").length;
  const lateCancelCount = studentSessions.filter((s) => s.status === "late_cancel").length;
  const noShowCount = studentSessions.filter((s) => s.status === "no_show").length;

  return {
    studentId: args.studentId,
    month: args.month,
    totalSessions,
    attendedCount,
    lateCancelCount,
    noShowCount,
    totalEarnedCents,
    totalPaidCents,
    openingBalanceCents,
    closingBalanceCents,
    dueCents: Math.max(0, closingBalanceCents),
    creditCents: Math.max(0, -closingBalanceCents),
    balanceCents: closingBalanceCents,
  };
}

export function getMonthlyReportRows(args: {
  studentId: string;
  month: string;
  sessions: Session[];
}) {
  return args.sessions
    .filter((s) => s.studentId === args.studentId && monthKeyFromMs(s.startAt) === args.month)
    .sort((a, b) => a.startAt - b.startAt)
    .map((s) => ({
      date: new Date(s.startAt).toLocaleDateString("en-LK"),
      status: s.status,
      feeCents: s.chargeCents ?? 0,
    }));
}