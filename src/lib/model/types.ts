export type UserRole = "admin" | "student";

export type SessionType = "individual" | "group" | "online";

export type AttendanceStatus =
  | "scheduled"
  | "attended"
  | "early_cancel"
  | "late_cancel"
  | "no_show";

export type PaymentStatus = "pending_verification" | "verified" | "rejected";

export type PaymentMethod = "cash" | "bank" | "online";

export type PaymentType =
  | "single"
  | "prepaid_4_weeks"
  | "prepaid_8_weeks"
  | "settlement";

export type RescheduleStatus = "requested" | "approved" | "rejected";

export type Student = {
  id: string;
  name?: string;
  fullName: string;
  parentName?: string;
  contactNumber?: string;
  email?: string;
  authUid: string;
  feePerSessionCents: number;
  sessionDurationMin: number;
  sessionType: SessionType;
  active: boolean;
  createdAt: number;
};

export type Weekday =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export type TimetableStudentRef = {
  id: string;
  name: string;
};

export type TimetableSlot = {
  id: string;
  day: Weekday;
  weekday?: number; // Legacy compatibility: 0=Sun ... 6=Sat
  startTime: string; // "HH:MM"
  endTime: string;
  duration: number; // minutes
  students: TimetableStudentRef[];
  notes?: string;
  isLocked: boolean;
  recurring?: boolean;
  exceptions?: string[];

  // Legacy compatibility fields
  durationMin?: number;
  studentId?: string | null;
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
  createdFrom: "timetable" | "reschedule" | "manual";
  notes?: string;
};

export type Payment = {
  id: string;
  studentId: string;
  amountCents: number;
  paidAt: number;
  method?: PaymentMethod;
  paymentType?: PaymentType;
  coverageNote?: string;
  notes?: string;
  status: PaymentStatus;
  slipPath?: string;
  slipUrl?: string;
  createdAt: number;
};

export type MonthlySummary = {
  studentId: string;
  month: string; // YYYY-MM
  totalSessions: number;
  attendedCount: number;
  lateCancelCount: number;
  noShowCount: number;
  totalEarnedCents: number;
  totalPaidCents: number;
  balanceCents: number;
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

