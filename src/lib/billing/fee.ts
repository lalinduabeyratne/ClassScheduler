import type { AttendanceStatus } from "@/lib/model/types";

export function computeChargeCents(args: {
  feePerSessionCents: number;
  status: AttendanceStatus;
}): number {
  const fee = Math.max(0, Math.trunc(args.feePerSessionCents));
  switch (args.status) {
    case "scheduled":
      return 0;
    case "attended":
      return fee;
    case "early_cancel":
      return 0;
    case "late_cancel":
      return Math.round(fee * 0.5);
    case "no_show":
      return fee;
    default: {
      const _exhaustive: never = args.status;
      return _exhaustive;
    }
  }
}

