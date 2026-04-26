import {
  collection,
  doc,
  getDoc,
  query,
  where,
  type Query,
  type Timestamp,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { col } from "./paths";
import type { Payment, Session, Student } from "@/lib/model/types";

export type UserDoc = {
  role: "admin" | "student";
  studentId?: string;
};

export async function getUserDoc(uid: string) {
  const snap = await getDoc(doc(db, col.users(), uid));
  return snap.exists() ? (snap.data() as UserDoc) : null;
}

export async function getStudentById(studentId: string) {
  const snap = await getDoc(doc(db, col.students(), studentId));
  return snap.exists()
    ? ({ id: snap.id, ...(snap.data() as Omit<Student, "id">) } as Student)
    : null;
}

export function qStudents(): Query<Record<string, unknown>> {
  return query(
    collection(db, col.students()),
    orderBy("fullName", "asc"),
    limit(1000),
  ) as Query<Record<string, unknown>>;
}

export function qSessionsForStudent(studentId: string): Query<Session> {
  return query(
    collection(db, col.sessions()),
    where("studentId", "==", studentId),
    limit(5000),
  ) as Query<Session>;
}

export function qPaymentsForStudent(studentId: string): Query<Payment> {
  return query(
    collection(db, col.payments()),
    where("studentId", "==", studentId),
    limit(5000),
  ) as Query<Payment>;
}

export function qPaymentsBetween(args: {
  startAtMs: number;
  endAtMs: number;
}): Query<Payment> {
  return query(
    collection(db, col.payments()),
    where("paidAt", ">=", args.startAtMs),
    where("paidAt", "<", args.endAtMs),
    orderBy("paidAt", "desc"),
    limit(5000),
  ) as Query<Payment>;
}

export function qSessionsBetween(args: {
  startAtMs: number;
  endAtMs: number;
}): Query<Session> {
  return query(
    collection(db, col.sessions()),
    where("startAt", ">=", args.startAtMs),
    where("startAt", "<", args.endAtMs),
    orderBy("startAt", "asc"),
    limit(5000),
  ) as Query<Session>;
}

export function qPendingPayments(): Query<Payment> {
  return query(
    collection(db, col.payments()),
    where("status", "==", "pending_verification"),
    limit(200),
  ) as Query<Payment>;
}

export function qTimetableSlots(): Query<Record<string, unknown>> {
  return query(
    collection(db, col.timetableSlots()),
    limit(500),
  ) as Query<Record<string, unknown>>;
}

export function qPendingRescheduleRequests(): Query<Record<string, unknown>> {
  return query(
    collection(db, col.rescheduleRequests()),
    where("status", "==", "requested"),
    limit(200),
  ) as Query<Record<string, unknown>>;
}

export function qRescheduleForStudent(studentId: string): Query<Record<string, unknown>> {
  return query(
    collection(db, col.rescheduleRequests()),
    where("studentId", "==", studentId),
    orderBy("createdAt", "desc"),
    limit(200),
  ) as Query<Record<string, unknown>>;
}

export function tsToMillis(
  ts: Timestamp | { seconds: number; nanoseconds: number } | number,
) {
  if (typeof ts === "number") return ts;
  return ts.seconds * 1000 + Math.floor(ts.nanoseconds / 1_000_000);
}

