'use client';

import { useEffect } from 'react';

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
          Something went wrong
        </p>
        <h1 className="mt-2 text-2xl font-semibold">We could not load this page.</h1>
        <p className="mt-3 text-sm text-[rgb(var(--muted))]">
          Try refreshing the page or use the button below to retry the request.
        </p>
        <button className="btn btn-primary mt-5 px-4 py-2" onClick={reset} type="button">
          Retry
        </button>
      </div>
    </div>
  );
}