import assert from "node:assert/strict";
import test from "node:test";
import {
  CALENDAR_DAY_END_HOUR,
  CALENDAR_DAY_START_HOUR,
  CALENDAR_TIMELINE_ROW_HEIGHT_PX,
  combineDateAndTime,
  clampDurationMinutes,
  clampWeekDayColumnWidth,
  eventDurationMinutes,
  getCalendarDays,
  getCalendarRange,
  getTimelineHours,
  normalizeDurationMinutes,
  projectResizeDuration,
  toDateInputValue,
  toTimeInputValue,
  setTimeOnDay,
  snapToSlot,
} from "../src/calendar.js";

const sampleEvent = {
  id: "event-1",
  ownerUserId: "user-1",
  title: "Sample",
  description: null,
  startsAt: "2026-05-04T09:00:00.000Z",
  endsAt: "2026-05-04T09:10:00.000Z",
  timezone: "America/Sao_Paulo",
  isAllDay: false,
  status: "confirmed" as const,
  createdAt: "2026-05-04T09:00:00.000Z",
  updatedAt: "2026-05-04T09:00:00.000Z",
  recurrence: null,
  participants: [],
  resources: [],
  sync: {
    eventId: "event-1",
    externalProvider: null,
    externalEventId: null,
    syncDirection: "local_to_external" as const,
    syncStatus: "pending" as const,
    lastSyncedAt: null,
    syncError: null,
    syncPayload: {},
  },
};

test("snaps durations to the nearest 15 minutes and enforces minimum duration", () => {
  assert.equal(snapToSlot(7), 0);
  assert.equal(snapToSlot(23), 30);
  assert.equal(normalizeDurationMinutes(7), 15);
  assert.equal(normalizeDurationMinutes(22), 15);
  assert.equal(normalizeDurationMinutes(23), 30);
  assert.equal(clampDurationMinutes(4), 15);
  assert.equal(clampDurationMinutes(2000), CALENDAR_DAY_END_HOUR * 60);
});

test("converts day and minutes to a concrete local date", () => {
  const day = new Date(2026, 4, 4, 0, 0, 0, 0);
  const date = setTimeOnDay(day, 14, 45);

  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 4);
  assert.equal(date.getDate(), 4);
  assert.equal(date.getHours(), 14);
  assert.equal(date.getMinutes(), 45);
});

test("formats and combines date and time inputs explicitly", () => {
  const inputDate = new Date(2026, 4, 4, 14, 45, 0, 0);
  const dateValue = toDateInputValue(inputDate);
  const timeValue = toTimeInputValue(inputDate);
  const combined = combineDateAndTime(dateValue, timeValue);

  assert.equal(dateValue, "2026-05-04");
  assert.equal(timeValue, "14:45");
  assert.equal(combined.getFullYear(), 2026);
  assert.equal(combined.getMonth(), 4);
  assert.equal(combined.getDate(), 4);
  assert.equal(combined.getHours(), 14);
  assert.equal(combined.getMinutes(), 45);
});

test("returns consistent calendar ranges and timeline hours", () => {
  const monday = new Date(2026, 4, 4, 12, 0, 0, 0);
  const dayRange = getCalendarRange("day", monday);
  const weekRange = getCalendarRange("week", monday);
  const monthDays = getCalendarDays("month", monday);
  const timelineHours = getTimelineHours();

  assert.equal(dayRange.start.getDate(), 4);
  assert.equal(dayRange.end.getDate(), 5);
  assert.equal(weekRange.start.getDay(), 1);
  assert.equal(monthDays.length, 42);
  assert.equal(timelineHours[0], 0);
  assert.equal(timelineHours.at(-1), 23);
  assert.equal(CALENDAR_DAY_START_HOUR, 0);
  assert.equal(CALENDAR_DAY_END_HOUR, 24);
  assert.equal(CALENDAR_TIMELINE_ROW_HEIGHT_PX, 72);
});

test("clamps the weekly day column width", () => {
  assert.equal(clampWeekDayColumnWidth(1), 120);
  assert.equal(clampWeekDayColumnWidth(160), 160);
  assert.equal(clampWeekDayColumnWidth(999), 260);
});

test("projects resize duration from the current event size", () => {
  assert.equal(projectResizeDuration(60, -18), 45);
  assert.equal(projectResizeDuration(60, 18), 75);
  assert.equal(projectResizeDuration(30, -1000), 15);
});

test("enforces minimum event duration from event records", () => {
  assert.equal(eventDurationMinutes(sampleEvent), 15);
});
