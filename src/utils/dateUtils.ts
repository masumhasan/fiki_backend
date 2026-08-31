/**
 * US Central Time (America/Chicago) Date Utility Module
 * Handles CST (UTC-6) / CDT (UTC-5) wall-clock time conversions, day boundaries, and formatting.
 */

export const CENTRAL_TZ = "America/Chicago";

/**
 * Get current wall-clock date/time in America/Chicago timezone formatted as YYYY-MM-DD.
 */
export function getCentralTodayStr(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

/**
 * Get day-of-week abbreviation in America/Chicago timezone ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat").
 */
export function getCentralDayAbbr(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL_TZ,
    weekday: "short",
  }).format(date);
}

/**
 * Get full day-of-week in America/Chicago timezone ("Sunday", "Monday", ...).
 */
export function getCentralDayFull(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL_TZ,
    weekday: "long",
  }).format(date);
}

/**
 * Helper to determine if a date is in Daylight Saving Time for America/Chicago (CDT UTC-5 vs CST UTC-6).
 */
export function isCentralDaylightTime(date: Date = new Date()): boolean {
  const timeZoneName = new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL_TZ,
    timeZoneName: "short",
  }).format(date);
  return timeZoneName.includes("CDT");
}

/**
 * Get start of day (00:00:00.000 Central) and end of day (23:59:59.999 Central) for a date string as UTC Dates.
 */
export function getCentralDayBounds(dateStr?: string, now: Date = new Date()): { start: Date; end: Date } {
  const targetStr = dateStr || getCentralTodayStr(now);
  const [year, month, day] = targetStr.split("-").map(Number);

  const sampleDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const offsetHours = isCentralDaylightTime(sampleDate) ? 5 : 6;

  const startUtcMs = Date.UTC(year, month - 1, day, offsetHours, 0, 0, 0);
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000 - 1;

  return {
    start: new Date(startUtcMs),
    end: new Date(endUtcMs),
  };
}

/**
 * Parse time string (e.g. "08:00 AM" or "16:00") on a specific dateStr (YYYY-MM-DD) into a UTC Date object in Central Time.
 */
export function parseCentralDateTime(timeStr: string, dateStr?: string, now: Date = new Date()): Date {
  const targetDateStr = dateStr || getCentralTodayStr(now);
  const [year, month, day] = targetDateStr.split("-").map(Number);

  let hours = 8;
  let minutes = 0;

  if (timeStr) {
    const trimmed = timeStr.trim();
    const ampm = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(trimmed);
    if (ampm) {
      let h = parseInt(ampm[1], 10);
      const m = parseInt(ampm[2], 10);
      const period = ampm[3] ? ampm[3].toUpperCase() : null;
      if (period === "PM" && h < 12) h += 12;
      if (period === "AM" && h === 12) h = 0;
      hours = h;
      minutes = m;
    }
  }

  const sampleDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const offsetHours = isCentralDaylightTime(sampleDate) ? 5 : 6;

  const utcMs = Date.UTC(year, month - 1, day, hours + offsetHours, minutes, 0, 0);
  return new Date(utcMs);
}
