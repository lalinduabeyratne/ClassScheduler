import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Physics Tutor Manager",
  description: "Scheduling, attendance, and fees for a physics tutor",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-[rgb(var(--border))]">
            <div className="container-page flex h-14 items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-[rgb(var(--brand))]" />
                <div className="text-sm font-semibold">Physics Tutor Manager</div>
              </div>
              <nav className="flex items-center gap-2 text-sm text-[rgb(var(--muted))]">
                <a className="hover:underline" href="/">
                  Home
                </a>
                <a className="hover:underline" href="/login">
                  Login
                </a>
              </nav>
            </div>
          </header>
          <main className="container-page py-8">{children}</main>
          <footer className="border-t border-[rgb(var(--border))] py-6">
            <div className="container-page text-xs text-[rgb(var(--muted))]">
              Built with Next.js + Firebase
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}

