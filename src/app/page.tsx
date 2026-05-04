import { RandomBackground } from "./_components/RandomBackground";

export default function HomePage() {
  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-slate-100 dark:bg-black">
      <RandomBackground />
      <section className="relative z-10 flex min-h-screen w-full items-center overflow-hidden p-6 text-slate-900 dark:text-slate-100 md:p-10">
        <div className="relative mx-auto grid w-full max-w-6xl items-center justify-center gap-10 md:grid-cols-[1.15fr_0.85fr]">
          <div>
            <span className="inline-flex items-center rounded-full border border-cyan-400/60 bg-cyan-100/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:border-cyan-300/40 dark:bg-cyan-300/10 dark:text-cyan-100">
              Physics Powered Learning
            </span>

            <h1 className="mt-4">
              <div className="text-5xl font-black tracking-tighter text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)] dark:drop-shadow-none dark:text-slate-100 md:text-7xl">
                Lalindu Abeyratne
              </div>
              <span className="block text-2xl font-bold text-cyan-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)] dark:drop-shadow-none dark:text-cyan-300 md:text-4xl">Physics Academy</span>
            </h1>
            <p className="mt-4 max-w-2xl text-base text-slate-700 dark:text-slate-300 md:text-lg">
              A smarter class scheduler inspired by orbital motion, wave cycles, and momentum -
              built to keep lessons, payments, and student progress in perfect sync.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                className="inline-flex items-center justify-center rounded-lg border border-cyan-500/70 bg-cyan-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_34px_-14px_rgba(8,145,178,0.9)] transition hover:bg-cyan-500 dark:border-cyan-300/70 dark:bg-cyan-400 dark:text-slate-900 dark:hover:bg-cyan-300"
                href="/login"
              >
                Login
              </a>
            </div>
            <div className="mt-6 flex flex-wrap gap-3 text-sm text-slate-700 dark:text-slate-200">
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
              <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Current focus</p>
              <p className="text-sm font-semibold">Theory, Paper and Revision</p>
            </div>
            <div className="floating-card floating-card-bottom">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-400">This week</p>
              <p className="text-sm font-semibold">31 classes scheduled this week</p>
            </div>
          </div>
        </div>
      </section>
      <footer className="absolute bottom-4 left-0 z-10 w-full text-center">
        <div className="text-xs text-slate-600 dark:text-slate-300">Made with <span aria-hidden>❤️</span> by Lalindu</div>
      </footer>
    </div>
  );
}


