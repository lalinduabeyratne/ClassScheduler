import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

export type UserRole = "admin" | "student";

export async function getUserRole(uid: string): Promise<UserRole> {
  const snap = await getDoc(doc(db, "users", uid));
  const role = snap.exists() ? (snap.data().role as unknown) : null;
  return role === "admin" ? "admin" : "student";
}

