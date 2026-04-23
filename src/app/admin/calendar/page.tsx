"use client";

import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase/client";
import { useAuthUser } from "@/lib/firebase/useAuthUser";
import { getUserRole } from "@/lib/roles/getUserRole";
import { qSessionsBetween } from "@/lib/firestore/api";
import { useFirestoreQuery } from "@/lib/firestore/hooks";
import type { Session } from "@/lib/model/types";
import { useStudentsMap } from "@/lib/students/useStudentsMap";

function startOfDayMs(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

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

export default function AdminCalendarPage() {
  const router = useRouter();
  const { user, loading } = useAuthUser();
  const [checkingRole, setCheckingRole] = useState(true);

  const now = new Date();
  const startMs = startOfDayMs(now);
  const endMs = startMs + 7 * 24 * 60 * 60 * 1000;

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    (async () => {
      const role = await getUserRole(user.uid);
      if (role !== "admin") router.replace("/student");
      setCheckingRole(false);
    })();
  }, [loading, router, user]);

  const ready = !loading && !checkingRole;
  const sessionsQuery = useMemo(
    () => (ready ? qSessionsBetween({ startAtMs: startMs, endAtMs: endMs }) : null),
    [endMs, ready, startMs],
  );
  const { data: sessions } = useFirestoreQuery<Session>(sessionsQuery);
  const { byId: studentsById } = useStudentsMap(ready);

  const grouped = useMemo(() => {
    const m = new Map<string, Session[]>();
    for (const s of sessions) {
      const key = new Date(s.startAt).toDateString();
      m.set(key, [...(m.get(key) ?? []), s]);
    }
    return m;
  }, [sessions]);

  if (loading || checkingRole) {
    return <div className="text-sm text-[rgb(var(--muted))]">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Calendar (next 7 days)</div>
            <div className="mt-1 text-sm text-[rgb(var(--muted))]">
              Sessions generated from the weekly timetable + approved reschedules.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a className="btn btn-ghost" href="/admin">
              Back
            </a>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await signOut(auth);
                router.replace("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      {grouped.size === 0 ? (
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
                  <li key={s.id} className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">
                        {timeLabel(s.startAt)} - {timeLabel(s.endAt)}
                      </div>
                      <div className="text-xs text-[rgb(var(--muted))]">
                        {studentsById.get(s.studentId)?.fullName ?? s.studentId}
                      </div>
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

