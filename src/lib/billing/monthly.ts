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
  const studentSessions = args.sessions.filter(
    (s) => s.studentId === args.studentId && monthKeyFromMs(s.startAt) === args.month,
  );
  const studentPayments = args.payments.filter(
    (p) => p.studentId === args.studentId && monthKeyFromMs(p.paidAt) === args.month,
  );

  const totalSessions = studentSessions.length;
  const attendedCount = studentSessions.filter((s) => s.status === "attended").length;
  const lateCancelCount = studentSessions.filter((s) => s.status === "late_cancel").length;
  const noShowCount = studentSessions.filter((s) => s.status === "no_show").length;
  const totalEarnedCents = studentSessions.reduce((sum, s) => sum + (s.chargeCents ?? 0), 0);
  const totalPaidCents = studentPayments
    .filter((p) => p.status === "verified")
    .reduce((sum, p) => sum + (p.amountCents ?? 0), 0);

  return {
    studentId: args.studentId,
    month: args.month,
    totalSessions,
    attendedCount,
    lateCancelCount,
    noShowCount,
    totalEarnedCents,
    totalPaidCents,
    balanceCents: totalEarnedCents - totalPaidCents,
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