// Scheduled Ghost Sessions: a weekly time window during which a Ghost Session
// runs automatically (for example weekdays 09:00–17:00 on an office computer).
// Times are local wall-clock "HH:MM"; days use Date#getDay() numbers (0 = Sunday).
// A window whose end is earlier than its start runs overnight into the next day.

export const DEFAULT_SCHEDULE = { enabled: false, days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };

export function parseTime(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Returns a cleaned copy of a schedule, or null if it cannot be used.
export function normalizeSchedule(input) {
  if (!input || typeof input !== "object") return null;
  const days = Array.isArray(input.days)
    ? [...new Set(input.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [];
  const start = parseTime(input.start);
  const end = parseTime(input.end);
  if (start === null || end === null || start === end) return null;
  return { enabled: input.enabled === true, days, start: input.start, end: input.end };
}

// The window that starts on the given calendar day: [start, end) in ms.
// Building dates from local parts keeps wall-clock times right across DST changes.
function windowOn(year, month, date, startMin, endMin) {
  const start = new Date(year, month, date, 0, startMin).getTime();
  const end = new Date(year, month, date + (endMin <= startMin ? 1 : 0), 0, endMin).getTime();
  return { start, end };
}

function windowsAround(schedule, now, fromDay, toDay) {
  const s = normalizeSchedule(schedule);
  if (!s || !s.enabled || s.days.length === 0) return [];
  const startMin = parseTime(s.start);
  const endMin = parseTime(s.end);
  const today = new Date(now);
  const out = [];
  for (let offset = fromDay; offset <= toDay; offset++) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    if (s.days.includes(day.getDay())) {
      out.push(windowOn(day.getFullYear(), day.getMonth(), day.getDate(), startMin, endMin));
    }
  }
  return out;
}

// The window active at `now`, or null.
export function activeWindow(schedule, now = Date.now()) {
  // An overnight window that started yesterday can still be running.
  return windowsAround(schedule, now, -1, 0).find((w) => now >= w.start && now < w.end) ?? null;
}

// The next start of a window after `now`, or null.
export function nextWindow(schedule, now = Date.now()) {
  return windowsAround(schedule, now, -1, 8).find((w) => w.start > now) ?? null;
}

// The next moment the schedule turns a session on or off, or null if never.
export function nextChange(schedule, now = Date.now()) {
  const times = windowsAround(schedule, now, -1, 8)
    .flatMap((w) => [w.start, w.end])
    .filter((t) => t > now);
  return times.length ? Math.min(...times) : null;
}
