"use client";

export function PrismaVideoBackground() {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden" aria-hidden>
      <video
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
        src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_170732_8a9ccda6-5cff-4628-b164-059c500a2b41.mp4"
      />

      <div className="noise-overlay pointer-events-none absolute inset-0 opacity-70 mix-blend-overlay" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60" />
    </div>
  );
}
