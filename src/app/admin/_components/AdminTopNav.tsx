"use client";

import { signOut } from "firebase/auth";
import { usePathname } from "next/navigation";
import { auth } from "@/lib/firebase/client";

export function AdminTopNav() {
  const pathname = usePathname();

  const mainNav = [
    { href: "/admin", label: "Today" },
    { href: "/admin/calendar", label: "Calendar" },
    { href: "/admin/sessions", label: "Sessions" },
  ];

  const setupNav = [
    { href: "/admin/students", label: "Students" },
    { href: "/admin/timetable", label: "Timetable" },
  ];

  const navClass = (href: string) => {
    const isActive = pathname === href;
    return `btn ${isActive ? "btn-primary" : "btn-ghost"}`;
  };

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Admin revenue engine</div>
          <div className="mt-1 text-sm text-[rgb(var(--muted))]">
            Automated attendance charging, fee tracking, payments, and monthly reports.
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {mainNav.map((item) => (
              <a key={item.href} className={navClass(item.href)} href={item.href}>
                {item.label}
              </a>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {setupNav.map((item) => (
              <a key={item.href} className={navClass(item.href)} href={item.href}>
                {item.label}
              </a>
            ))}
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await signOut(auth);
                window.location.assign("/");
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
