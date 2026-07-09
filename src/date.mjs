const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && toDateStringUTC(date) === value;
}

export function toDateStringUTC(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

export function toDateStringLocal(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

export function todayDateString() {
  return toDateStringLocal(new Date());
}

export function parseDateString(value) {
  if (!isDateString(value)) {
    throw new Error(`Invalid date: expected YYYY-MM-DD, got ${String(value)}`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

export function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function daysBetween(start, end) {
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

export function sundayOnOrBefore(date) {
  return addDays(date, -date.getUTCDay());
}
