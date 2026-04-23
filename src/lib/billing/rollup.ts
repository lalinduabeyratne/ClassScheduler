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

