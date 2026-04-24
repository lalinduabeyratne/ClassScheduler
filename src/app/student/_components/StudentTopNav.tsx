"use client";

import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase/client";

export function StudentTopNav() {
  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Student portal</div>
          <div className="mt-1 text-sm text-[rgb(var(--muted))]">
            View schedule, fees, payment slips, reschedule requests, and the weekly timetable.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a className="btn btn-ghost" href="/student">
            Home
          </a>
          <a className="btn btn-ghost" href="/student/calendar">
            Calendar
          </a>
          <a className="btn btn-ghost" href="/student/timetable">
            Weekly timetable
          </a>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              await signOut(auth);
              window.location.assign("/");
            }}
            type="button"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
