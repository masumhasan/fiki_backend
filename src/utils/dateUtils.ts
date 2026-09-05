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
 * Get tomorrow's wall-clock date in America/Chicago timezone formatted as YYYY-MM-DD.
 */
export function getCentralTomorrowStr(date: Date = new Date()): string {
  const todayStr = getCentralTodayStr(date);
  const [y, m, d] = todayStr.split("-").map(Number);
  const tomorrowDate = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
  return getCentralTodayStr(tomorrowDate);
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

/**
 * Parse time string (e.g. "08:00 AM", "8:00 AM", "12:00 AM", "6:30 AM", "9:00 PM") into minutes from start of day (0..1439).
 */
export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return 0;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const ampm = match[3] ? match[3].toUpperCase() : null;
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h * 60 + m;
}

/**
 * Calculate shift duration in minutes and format as string "Xh YYm".
 * Handles overnight shifts (e.g., 9:00 PM to 5:00 AM).
 */
export function calculateShiftDuration(startTime: string, endTime: string): {
  minutes: number;
  hours: number;
  text: string;
} {
  const startMins = parseTimeToMinutes(startTime);
  let endMins = parseTimeToMinutes(endTime);
  if (endMins < startMins) {
    endMins += 24 * 60;
  }
  const diff = endMins - startMins;
  const hrs = Math.floor(diff / 60);
  const mins = diff % 60;
  return {
    minutes: diff,
    hours: hrs + mins / 60,
    text: `${hrs}h ${String(mins).padStart(2, "0")}m`,
  };
}

