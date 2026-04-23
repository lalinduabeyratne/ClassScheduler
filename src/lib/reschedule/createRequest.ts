import { addDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { col } from "@/lib/firestore/paths";

export async function createRescheduleRequest(args: {
  studentId: string;
  fromSessionId: string;
  requestedStartAt: number;
  requestedEndAt: number;
  reason?: string;
}) {
  const now = Date.now();
  await addDoc(collection(db, col.rescheduleRequests()), {
    studentId: args.studentId,
    fromSessionId: args.fromSessionId,
    requestedStartAt: args.requestedStartAt,
    requestedEndAt: args.requestedEndAt,
    reason: args.reason ?? "",
    status: "requested",
    createdAt: now,
    updatedAt: now,
  });
}

