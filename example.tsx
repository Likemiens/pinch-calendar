"use client";

// A full-height agenda: a week in view, a few plans around today. Put it next to pinch-calendar.tsx.
import { useMemo, useState, useSyncExternalStore } from "react";
import { PinchCalendar, type CalendarEvent, type PinchCalendarLabels } from "./pinch-calendar";

const labels: PinchCalendarLabels = {
  calendar: "Calendar",
  density: "Days in view",
  today: "Back to today",
  days: (count) => `${count} ${count === 1 ? "day" : "days"}`,
};

// Today is the viewer's local date. A prerendered page can't know it, so it is read in the browser:
// null on the server, and the calendar mounts once it is known.
const subscribe = () => () => {};
const pad = (value: number) => String(value).padStart(2, "0");
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

// The ISO date `offset` days away. The calendar counts days in UTC, and so does this.
const addDays = (iso: string, offset: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

export function Agenda() {
  const [density, setDensity] = useState(7);
  const today = useSyncExternalStore(subscribe, localToday, () => null);

  // One array for all renders: the agenda re-renders on every frame of a pinch.
  const events = useMemo<CalendarEvent[]>(() => {
    if (!today) return [];
    return [
      { date: addDays(today, -1), time: "18:30", title: "Gym" },
      { date: today, time: "09:30", title: "Standup" },
      { date: today, time: "14:00", title: "Design review" },
      { date: addDays(today, 1), time: "16:00", title: "Dentist" },
      { date: addDays(today, 4), title: "Trip to Tbilisi" },
      { date: addDays(today, 5), title: "Trip to Tbilisi" },
      { date: addDays(today, 7), time: "10:00", title: "Sprint planning" },
    ];
  }, [today]);

  return (
    <div style={{ height: "100dvh" }}>
      {today && (
        <PinchCalendar
          from={addDays(today, -21)}
          length={84}
          today={today}
          density={density}
          onDensityChange={setDensity}
          events={events}
          locale="en"
          labels={labels}
        />
      )}
    </div>
  );
}
