import type { EventRecord } from "./types.js";

export type CalendarView = "day" | "week" | "month";

export const SLOT_MINUTES = 30;
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 21;

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

export function toEventDate(event: EventRecord, which: "start" | "end") {
  return new Date(which === "start" ? event.startsAt : event.endsAt);
}

export function clampMinutes(minutes: number) {
  return Math.min(DAY_END_HOUR * 60, Math.max(DAY_START_HOUR * 60, minutes));
}

export function snapToSlot(minutes: number) {
  return Math.round(minutes / SLOT_MINUTES) * SLOT_MINUTES;
}

export function eventStartMinutes(event: EventRecord) {
  const start = new Date(event.startsAt);
  return start.getHours() * 60 + start.getMinutes();
}

export function eventDurationMinutes(event: EventRecord) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  return Math.max(SLOT_MINUTES, Math.round((end.getTime() - start.getTime()) / 60_000));
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
