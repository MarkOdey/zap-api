/**
 * Local calendar facts for the theme agent.
 *
 * The calendar supplies the anchor (season, nearby holidays, time of day); the LLM
 * supplies the words. Everything here is pure and local — no network, no model —
 * so a themed lexicon can always be grounded even when Ollama is down.
 */

/**
 * A small fixed-date holiday set. Movable holidays (Easter, Thanksgiving) are
 * deliberately omitted for now — they need a calendar library — and are flagged in
 * the plan as a later addition. `{ name, month (1-12), day }`.
 */
export const HOLIDAYS = [
  { name: "New Year's Day", month: 1, day: 1 },
  { name: "Valentine's Day", month: 2, day: 14 },
  { name: "St. Patrick's Day", month: 3, day: 17 },
  { name: 'Halloween', month: 10, day: 31 },
  { name: 'Christmas', month: 12, day: 25 },
  { name: "New Year's Eve", month: 12, day: 31 },
];

/** How many days ahead counts as "near" a holiday. */
const NEAR_DAYS = Number(process.env.THEME_HOLIDAY_NEAR_DAYS || 3);

const DAY_MS = 86_400_000;

/** Northern-hemisphere meteorological seasons, by month. */
function seasonOf(month) {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

function timeOfDayOf(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Days from `now` to the next occurrence of month/day (this year or next). */
function daysUntil(now, month, day) {
  const year = now.getFullYear();
  let target = new Date(year, month - 1, day);
  const today = new Date(year, now.getMonth(), now.getDate());
  if (target < today) target = new Date(year + 1, month - 1, day);
  return Math.round((target - today) / DAY_MS);
}

/**
 * Factual context for the current moment.
 * @param {Date} [now]
 */
export function computeCalendar(now = new Date()) {
  const month = now.getMonth() + 1;
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - startOfYear) / DAY_MS);

  const nearbyHolidays = HOLIDAYS
    .map(h => ({ name: h.name, daysAway: daysUntil(now, h.month, h.day) }))
    .filter(h => h.daysAway <= NEAR_DAYS)
    .sort((a, b) => a.daysAway - b.daysAway);

  return {
    date: now.toISOString().slice(0, 10),
    dayOfYear,
    weekday: WEEKDAYS[now.getDay()],
    isWeekend: now.getDay() === 0 || now.getDay() === 6,
    hour: now.getHours(),
    timeOfDay: timeOfDayOf(now.getHours()),
    season: seasonOf(month),
    nearbyHolidays,
  };
}

/** A short natural-language description, handy as LLM context. */
export function describeCalendar(cal) {
  const parts = [`It is ${cal.timeOfDay} on ${cal.weekday}, ${cal.date}, in ${cal.season}`];
  if (cal.nearbyHolidays.length) {
    const h = cal.nearbyHolidays[0];
    parts.push(h.daysAway === 0 ? `— it is ${h.name}` : `— ${h.daysAway} day(s) to ${h.name}`);
  }
  return parts.join(' ') + '.';
}
