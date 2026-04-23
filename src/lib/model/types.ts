export type UserRole = "admin" | "student";

export type SessionType = "individual" | "group" | "online";

export type AttendanceStatus = "attended" | "early_cancel" | "late_cancel" | "no_show";

export type PaymentStatus = "pending_verification" | "verified" | "rejected";

export type RescheduleStatus = "requested" | "approved" | "rejected";

export type Student = {
  id: string;
  fullName: string;
  parentName?: string;
  authUid: string;
  feePerSessionCents: number;
  sessionDurationMin: number;
  sessionType: SessionType;
  active: boolean;
  createdAt: number;
};

export type TimetableSlot = {
  id: string;
  weekday: number; // 0=Sun ... 6=Sat
  startTime: string; // "HH:MM"
  durationMin: number;
  studentId: string | null;
  active: boolean;
};

export type Session = {
  id: string;
  studentId: string;
  slotId?: string;
  startAt: number; // ms epoch
  endAt: number; // ms epoch
  status: AttendanceStatus;
  statusUpdatedAt?: number;
  feePerSessionCents: number; // snapshot at time of session
  chargeCents: number; // computed from status + feePerSessionCents
  createdFrom: "timetable" | "reschedule";
  notes?: string;
};

export type Payment = {
  id: string;
  studentId: string;
  amountCents: number;
  paidAt: number;
  status: PaymentStatus;
  slipPath?: string;
  slipUrl?: string;
  createdAt: number;
};

export type RescheduleRequest = {
  id: string;
  studentId: string;
  fromSessionId: string;
  requestedStartAt: number;
  requestedEndAt: number;
  reason?: string;
  status: RescheduleStatus;
  adminNote?: string;
  createdAt: number;
  updatedAt: number;
};

