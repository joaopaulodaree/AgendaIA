import type { EventRecord } from "./types.js";

export type CalendarView = "day" | "week" | "month";

export const SNAP_INTERVAL_MINUTES = 15;
export const MIN_EVENT_DURATION_MINUTES = 15;
export const CALENDAR_DAY_START_HOUR = 7;
export const CALENDAR_DAY_END_HOUR = 21;
export const CALENDAR_TIMELINE_ROW_HEIGHT_PX = 72;

export const SLOT_MINUTES = SNAP_INTERVAL_MINUTES;
export const DAY_START_HOUR = CALENDAR_DAY_START_HOUR;
export const DAY_END_HOUR = CALENDAR_DAY_END_HOUR;

export function toLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

export function setTimeOnDay(date: Date, hour: number, minute = 0) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0);
}

export function startOfWeek(date: Date) {
  const mondayOffset = (date.getDay() + 6) % 7;
  return startOfDay(addDays(date, -mondayOffset));
}

export function endOfMonthGrid(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = startOfWeek(first);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const lastGrid = startOfWeek(last);
  return addDays(lastGrid, 6);
}

export function formatDayLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "short",
  }).format(date);
}

export function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

export function getCalendarRange(view: CalendarView, currentDate: Date) {
  if (view === "day") {
    const start = startOfDay(currentDate);
    return { start, end: addDays(start, 1) };
  }

  if (view === "week") {
    const start = startOfWeek(currentDate);
    return { start, end: addDays(start, 7) };
  }

  const start = startOfWeek(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
  return { start, end: addDays(endOfMonthGrid(currentDate), 1) };
}

export function getCalendarDays(view: CalendarView, currentDate: Date) {
  if (view === "day") {
    return [startOfDay(currentDate)];
  }

  if (view === "week") {
    const start = startOfWeek(currentDate);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }

  const first = startOfWeek(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}

export function getTimelineHours() {
  return Array.from(
    { length: CALENDAR_DAY_END_HOUR - CALENDAR_DAY_START_HOUR },
    (_, index) => CALENDAR_DAY_START_HOUR + index,
  );
}

export function toEventDate(event: EventRecord, which: "start" | "end") {
  return new Date(which === "start" ? event.startsAt : event.endsAt);
}

export function clampMinutes(minutes: number) {
  return Math.min(CALENDAR_DAY_END_HOUR * 60, Math.max(CALENDAR_DAY_START_HOUR * 60, minutes));
}

export function snapToSlot(minutes: number) {
  return Math.round(minutes / SNAP_INTERVAL_MINUTES) * SNAP_INTERVAL_MINUTES;
}

export function normalizeDurationMinutes(minutes: number) {
  return Math.max(MIN_EVENT_DURATION_MINUTES, snapToSlot(minutes));
}

export function clampDurationMinutes(minutes: number) {
  return normalizeDurationMinutes(clampMinutes(minutes));
}

export function eventStartMinutes(event: EventRecord) {
  const start = new Date(event.startsAt);
  return start.getHours() * 60 + start.getMinutes();
}

export function eventDurationMinutes(event: EventRecord) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  return Math.max(MIN_EVENT_DURATION_MINUTES, Math.round((end.getTime() - start.getTime()) / 60_000));
}

export function filterEventsForDay(events: EventRecord[], date: Date) {
  const key = toLocalDateKey(date);
  return events.filter((event) => toLocalDateKey(new Date(event.startsAt)) === key);
}

export function filterEventsForRange(events: EventRecord[], start: Date, end: Date) {
  return events.filter((event) => {
    const eventStart = new Date(event.startsAt).getTime();
    const eventEnd = new Date(event.endsAt).getTime();
    return eventStart < end.getTime() && eventEnd > start.getTime();
  });
}
