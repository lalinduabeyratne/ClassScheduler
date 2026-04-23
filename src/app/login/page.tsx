"use client";

import { useEffect, useMemo, useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase/client";
import { useAuthUser } from "@/lib/firebase/useAuthUser";
import { getUserRole } from "@/lib/roles/getUserRole";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuthUser();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = useMemo(
    () => email.trim().length > 3 && password.length > 5 && !submitting,
    [email, password, submitting],
  );

  useEffect(() => {
    if (!loading && user) {
      (async () => {
        const role = await getUserRole(user.uid);
        router.replace(role === "admin" ? "/admin" : "/student");
      })();
    }
  }, [loading, router, user]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="card p-6">
        <div className="text-lg font-semibold">Login</div>
        <p className="mt-1 text-sm text-[rgb(var(--muted))]">
          Admin (tutor) and each student/parent have separate credentials.
        </p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div className="space-y-1">
            <div className="label">Email</div>
            <input
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-1">
            <div className="label">Password</div>
            <input
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          {error ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <button className="btn btn-primary w-full" disabled={!canSubmit}>
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>

      <div className="mt-4 text-xs text-[rgb(var(--muted))]">
        Tip: You’ll create the admin user and student users in Firebase Auth,
        then assign roles in Firestore.
      </div>
    </div>
  );
}

