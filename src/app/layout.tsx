import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lalindu Abeyratne - Physics",
  description: "Lalindu Abeyratne - Physics student management system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <main className="min-h-screen">{children}</main>
      </body>
    </html>
  );
}

