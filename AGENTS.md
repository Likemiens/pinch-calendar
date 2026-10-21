# pinch-calendar: notes for coding agents

`PinchCalendar` is a React client component: a list of days whose density (days in view) follows a pinch.
Two files, no dependencies: `pinch-calendar.tsx` imports `./pinch-calendar.css` itself, so keep them side by
side. It needs React 19.2+ (`useEffectEvent`) and a bundler that handles CSS imports (Next.js, Vite). Install:
`npm i github:Likemiens/pinch-calendar` and import from `@likemiens/pinch-calendar` (JavaScript with its types),
or copy both files and import from `./pinch-calendar`. The file starts with
`"use client"`, so a Next.js server component can render it. `example.tsx` is a complete page.

## Contract

Exports `PinchCalendar`, `densityRange` (`[3, 14]`) and the types `PinchCalendarProps`, `CalendarEvent`,
`PinchCalendarLabels`, `PinchCalendarState`.

| Prop | Type | Notes |
|---|---|---|
| `from`, `today` | `string` | `YYYY-MM-DD`. `today` is the viewer's local date and gets the white plate |
| `length` | `number` | days in the list, counted from `from` |
| `density` | `number` | days in view, controlled |
| `onDensityChange` | `(density: number) => void` | every frame of a gesture and of the spring; whole at rest |
| `range?` | `readonly [number, number]` | where gestures settle; default `densityRange` |
| `events?` | `readonly CalendarEvent[]` | `{ date: "YYYY-MM-DD"; time?: string; title: string }` |
| `locale` | `string` | BCP 47 tag for the names of days and months |
| `labels` | `PinchCalendarLabels` | `{ calendar, density, today: string; days: (count: number) => string }` |
| `state?` | `"pinch" \| "focus" \| "away"` | forces a look for previews; leave it unset in apps |

Gestures, keys and `--pc-*` variables: README.md. CSS hooks: `.pc[data-size="s|m|l"]`, `[data-gesture]`, `[data-away]`.

## Recipes

Controlled density: `const [density, setDensity] = useState(7)`, then `density={density}
onDensityChange={setDensity}`. Show it as `Math.round(density)`.

Persisted density. The value is whole at rest, so save only whole values:
```tsx
const [density, setDensity] = useState(() => Number(localStorage.getItem("days-in-view")) || 7);
const onDensityChange = (next: number) => {
  setDensity(next);
  if (Number.isInteger(next)) localStorage.setItem("days-in-view", String(next));
};
```

Events from an API: timed events on the viewer's own day, sorted (all-day first), kept in state:
```tsx
type Row = { start: string; allDay: boolean; name: string };
const pad = (n: number) => String(n).padStart(2, "0");
const toEvent = ({ start, allDay, name }: Row): CalendarEvent => {
  if (allDay) return { date: start.slice(0, 10), title: name }; // a bare date: no time zone to apply
  const at = new Date(start);
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return { date, time: `${pad(at.getHours())}:${pad(at.getMinutes())}`, title: name };
};
const [events, setEvents] = useState<CalendarEvent[]>([]);
useEffect(() => {
  fetch("/api/events").then((r) => r.json()).then((rows: Row[]) => setEvents(rows.map(toEvent).sort(
    (a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""))));
}, []);
```

Other languages: `locale` names the days and months, `labels` are the words for screen readers.
```tsx
const plural = new Intl.PluralRules("ru");
const forms: Record<string, string> = { one: "день", few: "дня", many: "дней", other: "дня" };
const labels: PinchCalendarLabels = {
  calendar: "Календарь", density: "Дней в виде", today: "К сегодняшнему дню",
  days: (count) => `${count} ${forms[plural.select(count)]}`,
}; // <PinchCalendar locale="ru" labels={labels} … />
```

## Gotchas

- Pass `onDensityChange` values back unchanged, right away (no rounding, clamping, debouncing, `startTransition`).
  It draws first and reports after; a prop that differs from what it drew counts as a density from outside, which
  stops the spring and jumps there. The value is fractional while a pinch or the spring runs: round it only to show it.
- The parent needs a definite height (px, `dvh`, a sized flex or grid cell): the calendar is `height: 100%`.
  Under an auto-height parent it is 480 px tall. It never takes its size from its content (`contain: size`),
  so in a shrink-to-fit box (inline-block, a flex row item without a width) give it a width too.
- Dates are `YYYY-MM-DD`. An event's `date` is matched as a string, so give no time part. `time` is display
  text; events keep the order you pass them in.
- `today` is the viewer's local date (`toISOString()` gives the UTC one). On a prerendered page work it out in the
  browser, e.g. `useSyncExternalStore(() => () => {}, getToday, () => null)`, and render the calendar once known.
- Keep `events` referentially stable (state, a constant, `useMemo`): a new array rebuilds every day, and the
  parent re-renders on every frame of a pinch.
- `from` and `length` are a fixed window. A new `from` keeps the scroll offset, so other dates come into view;
  remount with a new `key` to start over at today.

## Don't

- Hold `density` fixed or ignore `onDensityChange`: the bands still move, but the grip's number goes stale.
- Set `--pc-row`, `--pc-k` or `--pc-grip`: the component writes them on every frame.
- Set the `--pc-*` colors on a parent alone. The defaults live on `.pc`, so target it (`.agenda .pc { … }`);
  only `--pc-speed` and `--ui-font` (the font) inherit from parents.
