/**
 * Turn raw timetable exception strings (stored in Firestore) into short labels
 * for students. Admins can use free-form strings; we still show them clearly.
 */
export function describeTimetableException(raw: string): string {
  const s = raw.trim();
  if (!s) return s;

  // Plain ISO date: treat as a calendar exception for that day
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-LK", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }
  }

  // date | note  or  date: note
  const split = s.match(/^(\d{4}-\d{2}-\d{2})\s*[|:]\s*(.+)$/);
  if (split) {
    const d = new Date(`${split[1]}T12:00:00`);
    const when = !Number.isNaN(d.getTime())
      ? d.toLocaleDateString("en-LK", { weekday: "short", month: "short", day: "numeric" })
      : split[1];
    return `${when} — ${split[2].trim()}`;
  }

  return s;
}
