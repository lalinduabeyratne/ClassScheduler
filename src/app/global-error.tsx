'use client';

import { useEffect } from 'react';

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen items-center justify-center p-6">
          <div className="max-w-md rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-6 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
              Application error
            </p>
            <h1 className="mt-2 text-2xl font-semibold">The app hit an unexpected problem.</h1>
            <p className="mt-3 text-sm text-[rgb(var(--muted))]">
              Retry the request. If this keeps happening, the route is throwing before it can render.
            </p>
            <button className="btn btn-primary mt-5 px-4 py-2" onClick={reset} type="button">
              Retry
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}