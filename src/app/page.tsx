export default function HomePage() {
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="text-xl font-semibold">Welcome</div>
        <p className="mt-2 text-sm text-[rgb(var(--muted))]">
          This app manages a physics tutor’s weekly timetable, attendance, fees,
          payments, and rescheduling.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a className="btn btn-primary" href="/login">
            Login
          </a>
          <a className="btn btn-ghost" href="/admin">
            Admin dashboard
          </a>
          <a className="btn btn-ghost" href="/student">
            Student portal
          </a>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-6">
          <div className="font-semibold">Attendance statuses</div>
          <ul className="mt-2 list-disc pl-5 text-sm text-[rgb(var(--muted))]">
            <li>Attended</li>
            <li>Early Cancel (≥ 24h): no charge</li>
            <li>Late Cancel (&lt; 24h): 50% charge</li>
            <li>No Show: 100% charge</li>
          </ul>
        </div>
        <div className="card p-6">
          <div className="font-semibold">Fee totals</div>
          <p className="mt-2 text-sm text-[rgb(var(--muted))]">
            The system auto-calculates: Total to date, Paid, and Remaining
            balance.
          </p>
        </div>
      </div>
    </div>
  );
}

