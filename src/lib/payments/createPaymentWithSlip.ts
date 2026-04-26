import { FirebaseError } from "firebase/app";
import { collection, deleteField, doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { col } from "@/lib/firestore/paths";

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function uploadSlipToStorage(args: {
  studentId: string;
  file: File;
  onProgress?: (percent: number) => void;
}): Promise<{ slipUrl: string }> {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim();
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET?.trim();

  if (!cloudName || !uploadPreset) {
    throw new Error(
      "Slip upload is not configured. Set NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET.",
    );
  }

  const fileNameLower = args.file.name.toLowerCase();
  const isPdf = args.file.type === "application/pdf" || fileNameLower.endsWith(".pdf");

  args.onProgress?.(0);
  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/${isPdf ? "raw" : "auto"}/upload`;
  const form = new FormData();
  form.append("file", args.file);
  form.append("upload_preset", uploadPreset);
  form.append("folder", `class-schedular/payment-slips/${args.studentId}`);

  args.onProgress?.(30);
  const response = await withTimeout(
    fetch(endpoint, {
      method: "POST",
      body: form,
    }),
    120_000,
    "Slip upload timed out. Please try again.",
  );

  if (!response.ok) {
    throw new Error("Slip upload failed. Check Cloudinary upload preset settings.");
  }

  const payload = (await response.json()) as { secure_url?: string };
  if (!payload.secure_url) {
    throw new Error("Slip upload failed: missing uploaded URL.");
  }
  args.onProgress?.(100);
  return { slipUrl: payload.secure_url };
}

export async function createPaymentWithSlip(args: {
  studentId: string;
  amountCents: number;
  file: File;
  onProgress?: (percent: number) => void;
}): Promise<{ paymentId: string; slipUrl: string }> {
  const createdAt = Date.now();
  const paidAt = Date.now();

  if (!args.file || args.file.size <= 0) {
    throw new Error("Please choose a valid slip file.");
  }

  const paymentRef = doc(collection(db, col.payments()));

  try {
    const { slipUrl } = await uploadSlipToStorage({
      studentId: args.studentId,
      file: args.file,
      onProgress: args.onProgress,
    });

    await setDoc(paymentRef, {
      studentId: args.studentId,
      amountCents: Math.max(0, Math.trunc(args.amountCents)),
      paidAt,
      method: "online",
      paymentType: "single",
      notes: "Student slip upload",
      status: "pending_verification",
      createdAt,
      slipUrl,
    });

    return { paymentId: paymentRef.id, slipUrl };
  } catch (err) {
    if (err instanceof FirebaseError) {
      if (err.code === "permission-denied") {
        throw new Error("Payment save blocked by Firestore rules. Please publish latest Firestore rules and try again.");
      }
    }
    throw err;
  }
}

export async function replacePaymentSlip(args: {
  paymentId: string;
  studentId: string;
  file: File;
  onProgress?: (percent: number) => void;
}): Promise<{ slipUrl: string }> {
  if (!args.file || args.file.size <= 0) {
    throw new Error("Please choose a valid slip file.");
  }

  try {
    const { slipUrl } = await uploadSlipToStorage({
      studentId: args.studentId,
      file: args.file,
      onProgress: args.onProgress,
    });

    await updateDoc(doc(db, col.payments(), args.paymentId), {
      slipPath: deleteField(),
      slipUrl,
      status: "pending_verification",
      updatedAt: Date.now(),
    });

    return { slipUrl };
  } catch (err) {
    if (err instanceof FirebaseError) {
      if (err.code === "permission-denied") {
        throw new Error("Slip update blocked by Firestore rules. Please publish latest Firestore rules and try again.");
      }
    }
    throw err;
  }
}

