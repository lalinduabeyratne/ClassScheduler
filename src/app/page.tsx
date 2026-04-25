export default function HomePage() {
  return (
    <div className="home-physics-bg relative flex min-h-screen w-full items-center justify-center overflow-hidden">
      <section className="physics-card relative flex min-h-screen w-full items-center overflow-hidden p-6 md:p-10">
        <div className="physics-grid absolute inset-0 opacity-40" aria-hidden />
        <div className="orbit orbit-lg" aria-hidden />
        <div className="orbit orbit-md" aria-hidden />
        <div className="particle particle-a" aria-hidden />
        <div className="particle particle-b" aria-hidden />
        <div className="particle particle-c" aria-hidden />

        <div className="relative mx-auto grid w-full max-w-6xl items-center justify-center gap-10 md:grid-cols-[1.15fr_0.85fr]">
          <div>
            <span className="inline-flex items-center rounded-full border border-[rgb(var(--border))] bg-white/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))] dark:bg-white/5">
              Physics Powered Learning
            </span>

            <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-6xl">
              Lalindu Abeyratne
              <span className="block text-[rgb(var(--brand))]">Physics Academy</span>
            </h1>
            <p className="mt-4 max-w-2xl text-base text-[rgb(var(--muted))] md:text-lg">
              A smarter class scheduler inspired by orbital motion, wave cycles, and momentum -
              built to keep lessons, payments, and student progress in perfect sync.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a className="btn btn-primary px-5 py-3" href="/login">
                Login
              </a>
            </div>
            <div className="mt-6 flex flex-wrap gap-3 text-sm text-[rgb(var(--muted))]">
              <span className="metric-chip">Quantum-ready Timetable</span>
              <span className="metric-chip">Wave-smooth Attendance</span>
              <span className="metric-chip">Energy-balanced Billing</span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-sm">
            <div className="photo-frame">
              <img
                src="/slide-1-custom.jpg"
                alt="Physics class poster 1"
                className="slide-image slide-image-1 h-full w-full object-cover"
              />
              <img
                src="/slide-2.jpg"
                alt="Physics class poster 2"
                className="slide-image slide-image-2 h-full w-full object-cover"
              />
              <img
                src="/slide-3.jpg"
                alt="Physics class poster 3"
                className="slide-image slide-image-3 h-full w-full object-cover"
              />
            </div>
            <div className="floating-card floating-card-top">
              <p className="text-xs font-medium text-[rgb(var(--muted))]">Current focus</p>
              <p className="text-sm font-semibold">Theory, Paper and Revision</p>
            </div>
            <div className="floating-card floating-card-bottom">
              <p className="text-xs font-medium text-[rgb(var(--muted))]">This week</p>
              <p className="text-sm font-semibold">12 classes scheduled</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

