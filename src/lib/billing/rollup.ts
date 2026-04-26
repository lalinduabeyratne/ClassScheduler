import type { Payment, Session } from "@/lib/model/types";

export function computeStudentBalance(args: {
  sessions: Session[];
  payments: Payment[];
}) {
  const totalChargedCents = args.sessions.reduce(
    (sum, s) => sum + (s.chargeCents ?? 0),
    0,
  );

  const totalPaidCents = args.payments
    .filter((p) => p.status === "verified")
    .reduce((sum, p) => sum + (p.amountCents ?? 0), 0);

  const remainingCents = totalChargedCents - totalPaidCents;
  return { totalChargedCents, totalPaidCents, remainingCents };
}

export function allocateVerifiedPaymentsOldestFirst(args: {
  sessions: Session[];
  payments: Payment[];
}) {
  const chargedSessions = [...args.sessions]
    .filter((session) => Math.max(0, Number(session.chargeCents ?? 0)) > 0)
    .sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0));

  let paidCentsRemaining = args.payments
    .filter((payment) => payment.status === "verified")
    .reduce((sum, payment) => sum + Math.max(0, Number(payment.amountCents ?? 0)), 0);

  const fullyPaidSessionIds = new Set<string>();
  const partiallyPaidSessionIds = new Set<string>();

  for (const session of chargedSessions) {
    const chargeCents = Math.max(0, Number(session.chargeCents ?? 0));
    if (chargeCents <= 0) continue;
    if (paidCentsRemaining <= 0) break;

    const coveredCents = Math.min(chargeCents, paidCentsRemaining);
    paidCentsRemaining -= coveredCents;

    if (coveredCents >= chargeCents) {
      fullyPaidSessionIds.add(session.id);
    } else if (coveredCents > 0) {
      partiallyPaidSessionIds.add(session.id);
    }
  }

  return {
    fullyPaidSessionIds,
    partiallyPaidSessionIds,
    remainingCreditCents: Math.max(0, paidCentsRemaining),
  };
}

