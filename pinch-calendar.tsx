"use client";

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import "./pinch-calendar.css";

// A list of days after Timepage. Every day is a band of one height, and a pinch decides how many bands fit
// the view. While the fingers move, the bands follow them without steps and the day under the fingers stays
// under them; when the fingers lift, a spring brings the view to a whole number of days.

export const densityRange = [3, 14] as const;

export type CalendarEvent = {
  /** ISO date: 2026-10-16 */
  date: string;
  /** shown before the title as it is, "09:30"; without it the event takes the whole day */
  time?: string;
  title: string;
};

/** A state the component shows on its own, without fingers or keys — for previews. */
export type PinchCalendarState = "pinch" | "focus" | "away";

export type PinchCalendarLabels = {
  /** the name of the list of days */
  calendar: string;
  /** the name of the grip: a slider of the days in view */
  density: string;
  /** the round button that brings today back into view */
  today: string;
  days: (count: number) => string;
};

export type PinchCalendarProps = {
  /** the first day of the list, ISO date */
  from: string;
  /** how many days the list holds */
  length: number;
  /** the day on the white plate, ISO date */
  today: string;
  /** days in view: whole at rest, fractional while a gesture or the spring is under way */
  density: number;
  /** every frame of a gesture and of the spring; the component draws what it reports, so pass it back as is */
  onDensityChange: (density: number) => void;
  /** the fewest and the most days a gesture settles on; a density outside is drawn as a stretch */
  range?: readonly [number, number];
  events?: readonly CalendarEvent[];
  /** a BCP 47 tag for the names of days and months */
  locale: string;
  labels: PinchCalendarLabels;
  state?: PinchCalendarState;
};

type Gesture = {
  kind: "touch" | "wheel" | "safari" | "grip";
  /** the density when it began */
  from: number;
  /** the density the hand asks for, before the stretch past the range */
  raw: number;
  /** the distance between the fingers, or where the grip was taken */
  start: number;
  samples: { at: number; value: number }[];
};

type SafariGestureEvent = Event & { scale: number; clientY?: number };

const day = 86_400_000;
const time = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const clamp = (value: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, value));
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// "Oct." → "Oct": the labels are set in capitals
const short = (text: string) => text.replace(/\.$/, "");

// Past the range a pinch still stretches the days, giving way less and less: at most by this much in the
// logarithm of the density, as the rubber band of iOS.
const stretch = 0.3;

function rubber(value: number, range: readonly [number, number]) {
  const limit = clamp(value, range);
  if (limit === value) return value;
  const over = Math.abs(Math.log(value / limit));
  return limit * Math.exp(Math.sign(value - limit) * stretch * (1 - 1 / ((over * 0.55) / stretch + 1)));
}

// The spring of the release: about 400 ms, and an overshoot of a hair.
const stiffness = 340;
const damping = 30;
// how far the speed of the fingers carries the density on release, in seconds
const projection = 0.12;

export function PinchCalendar({
  from,
  length,
  today,
  density,
  onDensityChange,
  range = densityRange,
  events,
  locale,
  labels,
  state,
}: PinchCalendarProps) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // What is on the screen. It runs ahead of the props: a gesture draws first and reports after. The anchor is
  // the point of the list (in days) that stays at `y` of the view when the density changes; `drawn` is the
  // scroll the last drawing left, so that a scroll of the hand can be told from one of the component's own.
  const view = useRef({ density, height: 0, anchor: { day: 0, y: 0 }, drawn: 0, target: density, frame: 0, wheel: 0 });
  const gesture = useRef<Gesture | null>(null);
  const [away, setAway] = useState<"up" | "down" | null>(null);
  const todayIndex = Math.round((time(today) - time(from)) / day);
  const latest = useRef({ range, onDensityChange, todayIndex, length });
  useLayoutEffect(() => {
    latest.current = { range, onDensityChange, todayIndex, length };
  });

  const rowHeight = () => view.current.height / view.current.density;

  // where today's band is: above the view, below it, or in it
  const look = () => {
    const box = list.current;
    const { todayIndex, length } = latest.current;
    if (!box || !view.current.height || todayIndex < 0 || todayIndex >= length) return setAway(null);
    const row = rowHeight();
    const top = todayIndex * row - box.scrollTop;
    setAway(top + row <= 1 ? "up" : top >= view.current.height - 1 ? "down" : null);
  };

  /** Keeps the point of the list now at `y` of the view (in fractions of days) where it will be drawn. */
  const anchorAt = (y: number) => {
    const box = list.current;
    if (box && view.current.height) view.current.anchor = { day: (box.scrollTop + y) / rowHeight(), y };
  };

  // Draws a density: the height of the bands, and the scroll that keeps the anchor in its place.
  const draw = (value: number) => {
    const current = view.current;
    current.density = value;
    const node = root.current;
    const box = list.current;
    if (!node || !box || !current.height) return;
    const row = current.height / value;
    const [min, max] = latest.current.range;
    node.style.setProperty("--pc-row", `${row}px`);
    node.style.setProperty("--pc-k", String(row / 84));
    node.dataset.size = row < 46 ? "s" : row < 150 ? "m" : "l";
    node.toggleAttribute("data-stretched", value < min - 0.005 || value > max + 0.005);
    box.scrollTop = current.anchor.day * row - current.anchor.y;
    current.drawn = box.scrollTop;
    look();
  };

  // A scroll by the hand moves the anchor with the list. The component's own scrolls, and the ones the
  // browser makes when it clamps a list that has just changed its size, leave the anchor where it was.
  const onScroll = () => {
    const box = list.current;
    if (box && Math.abs(box.scrollTop - view.current.drawn) > 0.5) {
      anchorAt(view.current.anchor.y);
      view.current.drawn = box.scrollTop;
    }
    look();
  };

  const report = (value: number) => {
    draw(value);
    latest.current.onDensityChange(value);
  };

  const springTo = (target: number, velocity = 0) => {
    const current = view.current;
    cancelAnimationFrame(current.frame);
    current.frame = 0;
    current.target = target;
    if (reducedMotion() || current.density === target) return report(target);
    let value = current.density;
    let speed = Math.max(-40, Math.min(40, velocity));
    let last = performance.now();
    const step = (now: number) => {
      let left = Math.min(0.064, (now - last) / 1000);
      last = now;
      while (left > 0) {
        const h = Math.min(left, 1 / 240);
        speed += (-stiffness * (value - target) - damping * speed) * h;
        value += speed * h;
        left -= h;
      }
      const done = Math.abs(value - target) < 0.003 && Math.abs(speed) < 0.03;
      report(done ? target : value);
      current.frame = done ? 0 : requestAnimationFrame(step);
    };
    current.frame = requestAnimationFrame(step);
  };

  // A day fewer or more, from where a running spring is heading. The top of the view stays.
  const stepBy = (delta: number) => {
    const current = view.current;
    if (!current.frame) anchorAt(0);
    springTo(clamp((current.frame ? current.target : Math.round(current.density)) + delta, latest.current.range));
  };

  const begin = (kind: Gesture["kind"], y: number, start = 0) => {
    cancelAnimationFrame(view.current.frame);
    view.current.frame = 0;
    anchorAt(y);
    gesture.current = { kind, from: view.current.density, raw: view.current.density, start, samples: [] };
    if (root.current) root.current.dataset.gesture = kind;
  };

  // The hand asks for `raw`; past the range it gets the stretch. The anchor follows the hand to `y`.
  const move = (raw: number, y: number) => {
    const current = gesture.current;
    if (!current) return;
    const value = rubber(raw, latest.current.range);
    const at = performance.now();
    current.raw = raw;
    current.samples = [...current.samples.filter((sample) => at - sample.at < 90), { at, value }];
    view.current.anchor.y = y;
    report(value);
  };

  const end = () => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    delete root.current?.dataset.gesture;
    const [first] = current.samples;
    const last = current.samples[current.samples.length - 1];
    const velocity = first && last && last.at > first.at ? ((last.value - first.value) * 1000) / (last.at - first.at) : 0;
    springTo(clamp(Math.round(view.current.density + velocity * projection), latest.current.range), velocity);
  };

  const viewY = (clientY: number) => clientY - (list.current?.getBoundingClientRect().top ?? 0);

  // Two fingers pinch; one finger scrolls the list natively. Once a scroll is under way the browser no longer
  // lets go of it (the event is not cancelable), and the second finger is left to it.
  const onTouchStart = useEffectEvent((event: TouchEvent) => {
    if (event.touches.length !== 2 || !event.cancelable || gesture.current) return;
    event.preventDefault();
    const [a, b] = [event.touches[0], event.touches[1]];
    begin("touch", viewY((a.clientY + b.clientY) / 2), Math.max(24, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)));
  });

  const onTouchMove = useEffectEvent((event: TouchEvent) => {
    const current = gesture.current;
    if (current?.kind !== "touch" || event.touches.length < 2) return;
    event.preventDefault();
    const [a, b] = [event.touches[0], event.touches[1]];
    const distance = Math.max(24, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));
    move((current.from * current.start) / distance, viewY((a.clientY + b.clientY) / 2));
  });

  const onTouchEnd = useEffectEvent((event: TouchEvent) => {
    if (gesture.current?.kind === "touch" && event.touches.length < 2) end();
  });

  // A pinch on a trackpad comes as a wheel with Ctrl in Chrome, Edge and Firefox, and as Ctrl with a mouse
  // wheel. The pinch has no end of its own: it ends when the wheel has been still for a moment.
  const onWheel = useEffectEvent((event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const y = viewY(event.clientY);
    if (gesture.current?.kind !== "wheel") {
      end();
      begin("wheel", y);
    }
    const current = gesture.current;
    if (!current) return;
    const delta = Math.max(-24, Math.min(24, event.deltaY * (event.deltaMode === 1 ? 33 : 1)));
    move(current.raw * Math.exp(delta / 100), y);
    clearTimeout(view.current.wheel);
    view.current.wheel = window.setTimeout(end, 140);
  });

  // Safari on a Mac reports a trackpad pinch as its own gesture events. On iPhone they come along with the
  // touches, which already pinch, so they only have to be kept from zooming the page.
  const onGesture = useEffectEvent((event: SafariGestureEvent) => {
    event.preventDefault();
    const current = gesture.current;
    const y = event.clientY === undefined ? view.current.height / 2 : viewY(event.clientY);
    if (event.type === "gesturestart" && !current) begin("safari", y);
    else if (current?.kind === "safari" && event.type === "gesturechange") move(current.from / event.scale, y);
    else if (current?.kind === "safari" && event.type === "gestureend") end();
  });

  const onResize = useEffectEvent(() => {
    const height = list.current?.clientHeight ?? 0;
    if (height === view.current.height) return;
    view.current.height = height;
    draw(view.current.density);
  });

  // First drawing: today at the top, under a sliver of the day before.
  useLayoutEffect(() => {
    view.current.height = list.current?.clientHeight ?? 0;
    const { todayIndex, length } = latest.current;
    view.current.anchor = { day: todayIndex >= 0 && todayIndex < length ? Math.max(0, todayIndex - 0.35) : 0, y: 0 };
    draw(view.current.density);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A density from outside — the parent's own animation, a saved preference — keeps the top of the view.
  // What the component reported itself comes back equal to what is drawn and is left alone.
  useLayoutEffect(() => {
    if (density === view.current.density) return;
    cancelAnimationFrame(view.current.frame);
    view.current.frame = 0;
    view.current.target = density;
    anchorAt(0);
    draw(density);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density]);

  useEffect(() => {
    const box = list.current;
    const node = root.current;
    if (!box || !node) return;
    const active = { passive: false };
    // Fingers pinch and scroll the list. A trackpad pinch is taken on the whole calendar: over the grip or the
    // today button it would otherwise zoom the page.
    const listeners: [Element, string, EventListener, AddEventListenerOptions?][] = [
      [box, "touchstart", (event) => onTouchStart(event as TouchEvent), active],
      [box, "touchmove", (event) => onTouchMove(event as TouchEvent), active],
      [box, "touchend", (event) => onTouchEnd(event as TouchEvent)],
      [box, "touchcancel", (event) => onTouchEnd(event as TouchEvent)],
      [box, "scroll", () => onScroll(), { passive: true }],
      [node, "wheel", (event) => onWheel(event as WheelEvent), active],
      [node, "gesturestart", (event) => onGesture(event as SafariGestureEvent), active],
      [node, "gesturechange", (event) => onGesture(event as SafariGestureEvent), active],
      [node, "gestureend", (event) => onGesture(event as SafariGestureEvent), active],
    ];
    for (const [target, type, listener, options] of listeners) target.addEventListener(type, listener, options);
    const observer = new ResizeObserver(() => onResize());
    observer.observe(box);
    const current = view.current;
    return () => {
      for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
      observer.disconnect();
      cancelAnimationFrame(current.frame);
      clearTimeout(current.wheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The grip pinches with one pointer: the top of the view holds as the other finger would, and the day
  // taken with the grip follows the pointer.
  const grip = {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0 || gesture.current) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      begin("grip", 0, viewY(event.clientY));
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const current = gesture.current;
      if (current?.kind !== "grip" || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const y = Math.max(16, Math.min(view.current.height - 16, viewY(event.clientY)));
      root.current?.style.setProperty("--pc-grip", `${y}px`);
      move((current.from * current.start) / y, 0);
    },
    onLostPointerCapture() {
      root.current?.style.removeProperty("--pc-grip");
      if (gesture.current?.kind === "grip") end();
    },
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      const [min, max] = latest.current.range;
      const delta = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 3, PageDown: -3 }[event.key];
      if (event.key === "Home" || event.key === "End") {
        anchorAt(0);
        springTo(event.key === "Home" ? min : max);
      } else if (delta) stepBy(delta);
      else return;
      event.preventDefault();
    },
  };

  const toToday = () => {
    const box = list.current;
    const { todayIndex } = latest.current;
    box?.scrollTo({ top: (todayIndex - 0.35) * rowHeight(), behavior: reducedMotion() ? "auto" : "smooth" });
  };

  const days = useMemo(() => {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
    const month = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
    const spoken = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    const byDate = new Map<string, CalendarEvent[]>();
    for (const event of events ?? []) byDate.set(event.date, [...(byDate.get(event.date) ?? []), event]);
    const start = time(from);

    return Array.from({ length }, (_, index) => {
      const at = start + index * day;
      const date = new Date(at);
      const iso = date.toISOString().slice(0, 10);
      const number = date.getUTCDate();
      const items = byDate.get(iso);
      return (
        <li
          key={iso}
          className="pc-day"
          data-odd={Math.round(at / day) % 2 ? "" : undefined}
          data-first={number === 1 ? "" : undefined}
          data-today={iso === today ? "" : undefined}
          aria-current={iso === today ? "date" : undefined}
        >
          <span className="pc-date" aria-hidden="true">
            <span className="pc-label">
              <span className="pc-weekday">{short(weekday.format(date))}</span>
              <span className="pc-number">{number}</span>
              <span className="pc-month">{short(month.format(date))}</span>
            </span>
          </span>
          <span className="pc-sr">{spoken.format(date)}</span>
          {items && (
            <ul className="pc-events">
              {items.map((item, position) => (
                <li key={position} className="pc-event" data-all-day={item.time ? undefined : ""}>
                  {item.time && <span className="pc-time">{item.time}</span>}
                  <span className="pc-title">{item.title}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      );
    });
  }, [from, length, today, locale, events]);

  const whole = Math.round(density);
  // previewed with today in view, the button points up, as it does after a scroll into the coming days
  const shownAway = state === "away" ? (away ?? "up") : away;

  return (
    <div ref={root} className="pc" data-state={state} data-away={shownAway ?? undefined}>
      <div
        ref={list}
        className="pc-list"
        role="region"
        tabIndex={0}
        aria-label={labels.calendar}
        onKeyDown={(event) => {
          if (event.metaKey || event.ctrlKey || event.altKey) return;
          const delta = event.key === "+" || event.key === "=" ? -1 : event.key === "-" || event.key === "_" ? 1 : 0;
          if (!delta) return;
          event.preventDefault();
          stepBy(delta);
        }}
      >
        <ol className="pc-days">{days}</ol>
      </div>

      <div
        className="pc-grip"
        role="slider"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={labels.density}
        aria-valuemin={range[0]}
        aria-valuemax={range[1]}
        aria-valuenow={whole}
        aria-valuetext={labels.days(whole)}
        {...grip}
      >
        <span className="pc-count" aria-hidden="true">{whole}</span>
        <svg className="pc-dots" viewBox="0 0 4 16" aria-hidden="true">
          <circle cx="2" cy="2" r="1.5" />
          <circle cx="2" cy="8" r="1.5" />
          <circle cx="2" cy="14" r="1.5" />
        </svg>
      </div>

      <button type="button" className="pc-today" aria-label={labels.today} inert={!shownAway} onClick={toToday}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 6 8 10.5 12.5 6" />
        </svg>
      </button>
    </div>
  );
}
