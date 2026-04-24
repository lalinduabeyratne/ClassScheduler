"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuthUser } from "@/lib/firebase/useAuthUser";
import { getUserRole } from "@/lib/roles/getUserRole";
import { getUserDoc, qSessionsForStudent } from "@/lib/firestore/api";
import { useFirestoreQuery } from "@/lib/firestore/hooks";
import type { Session } from "@/lib/model/types";
import { StudentTopNav } from "@/app/student/_components/StudentTopNav";

function dayLabel(ms: number) {
  return new Intl.DateTimeFormat("en-LK", {
    weekday: "short",
    month: "short",
    day: "2-digit",
  }).format(new Date(ms));
}

function timeLabel(ms: number) {
  return new Intl.DateTimeFormat("en-LK", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

export default function StudentCalendarPage() {
  const router = useRouter();
  const { user, loading } = useAuthUser();
  const [checkingRole, setCheckingRole] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [studentId, setStudentId] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    (async () => {
      try {
        const role = await getUserRole(user.uid);
        if (!role) {
          setAccessError("Your account has no Firestore role document yet.");
          router.replace("/login");
          return;
        }
        if (role !== "student") {
          router.replace("/admin");
          return;
        }
        const u = await getUserDoc(user.uid);
        setStudentId(u?.studentId ?? null);
      } catch (err) {
        setAccessError(
          err instanceof Error
            ? err.message
            : "Firestore denied access while checking the student role.",
        );
        router.replace("/login");
      } finally {
        setCheckingRole(false);
      }
    })();
  }, [loading, router, user]);

  const sessionsQuery = useMemo(
    () => (studentId && !accessError ? qSessionsForStudent(studentId) : null),
    [accessError, studentId],
  );
  const { data: sessions } = useFirestoreQuery<Session>(sessionsQuery);

  const next7Days = useMemo(() => {
    const start = new Date();
    const startMs = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate(),
    ).getTime();
    const endMs = startMs + 7 * 24 * 60 * 60 * 1000;
    return sessions
      .filter((s) => s.startAt >= startMs && s.startAt < endMs)
      .sort((a, b) => a.startAt - b.startAt);
  }, [sessions]);

  const grouped = useMemo(() => {
    const m = new Map<string, Session[]>();
    for (const s of next7Days) {
      const key = new Date(s.startAt).toDateString();
      m.set(key, [...(m.get(key) ?? []), s]);
    }
    return m;
  }, [next7Days]);

  if (loading || checkingRole) {
    return <div className="text-sm text-[rgb(var(--muted))]">Loading...</div>;
  }

  if (accessError) {
    return <div className="text-sm text-red-300">{accessError}</div>;
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:px-6 md:py-8">
      <StudentTopNav />

      <div className="card p-6">
        <div className="text-lg font-semibold">My calendar (next 7 days)</div>
        <div className="mt-1 text-sm text-[rgb(var(--muted))]">
          Upcoming sessions generated from the weekly timetable (and any approved reschedules).
        </div>
      </div>

      {!studentId ? (
        <div className="card p-6 text-sm text-[rgb(var(--muted))]">
          Your account is missing a linked student record.
        </div>
      ) : grouped.size === 0 ? (
        <div className="card p-6 text-sm text-[rgb(var(--muted))]">
          No sessions in the next 7 days.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from(grouped.entries()).map(([key, daySessions]) => (
            <div key={key} className="card p-6">
              <div className="font-semibold">{dayLabel(daySessions[0]!.startAt)}</div>
              <ul className="mt-3 space-y-2 text-sm">
                {daySessions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between">
                    <div className="font-medium">
                      {timeLabel(s.startAt)} - {timeLabel(s.endAt)}
                    </div>
                    <div className="text-xs text-[rgb(var(--muted))]">
                      {s.status.replaceAll("_", " ")}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

