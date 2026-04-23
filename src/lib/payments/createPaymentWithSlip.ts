import { addDoc, collection, serverTimestamp, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "@/lib/firebase/client";
import { col } from "@/lib/firestore/paths";

export async function createPaymentWithSlip(args: {
  studentId: string;
  amountCents: number;
  file: File;
}): Promise<{ paymentId: string; slipPath: string; slipUrl: string }> {
  const createdAt = Date.now();
  const paidAt = Date.now();

  const paymentRef = await addDoc(collection(db, col.payments()), {
    studentId: args.studentId,
    amountCents: Math.max(0, Math.trunc(args.amountCents)),
    paidAt,
    status: "pending_verification",
    createdAt,
  });

  const safeName = args.file.name.replace(/[^\w.\-]+/g, "_");
  const slipPath = `payment-slips/${args.studentId}/${paymentRef.id}-${safeName}`;
  const storageRef = ref(storage, slipPath);
  await uploadBytes(storageRef, args.file, {
    contentType: args.file.type || "application/octet-stream",
  });
  const slipUrl = await getDownloadURL(storageRef);

  await updateDoc(paymentRef, { slipPath, slipUrl });
  return { paymentId: paymentRef.id, slipPath, slipUrl };
}

