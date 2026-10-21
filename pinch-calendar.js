"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import "./pinch-calendar.css";
const densityRange = [3, 14];
const day = 864e5;
const time = (iso) => Date.parse(`${iso}T00:00:00Z`);
const clamp = (value, [min, max]) => Math.min(max, Math.max(min, value));
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const short = (text) => text.replace(/\.$/, "");
const stretch = 0.3;
function rubber(value, range) {
  const limit = clamp(value, range);
  if (limit === value) return value;
  const over = Math.abs(Math.log(value / limit));
  return limit * Math.exp(Math.sign(value - limit) * stretch * (1 - 1 / (over * 0.55 / stretch + 1)));
}
const stiffness = 340;
const damping = 30;
const projection = 0.12;
function PinchCalendar({
  from,
  length,
  today,
  density,
  onDensityChange,
  range = densityRange,
  events,
  locale,
  labels,
  state
}) {
  const root = useRef(null);
  const list = useRef(null);
  const view = useRef({ density, height: 0, anchor: { day: 0, y: 0 }, drawn: 0, target: density, frame: 0, wheel: 0 });
  const gesture = useRef(null);
  const [away, setAway] = useState(null);
  const todayIndex = Math.round((time(today) - time(from)) / day);
  const latest = useRef({ range, onDensityChange, todayIndex, length });
  useLayoutEffect(() => {
    latest.current = { range, onDensityChange, todayIndex, length };
  });
  const rowHeight = () => view.current.height / view.current.density;
  const look = () => {
    const box = list.current;
    const { todayIndex: todayIndex2, length: length2 } = latest.current;
    if (!box || !view.current.height || todayIndex2 < 0 || todayIndex2 >= length2) return setAway(null);
    const row = rowHeight();
    const top = todayIndex2 * row - box.scrollTop;
    setAway(top + row <= 1 ? "up" : top >= view.current.height - 1 ? "down" : null);
  };
  const anchorAt = (y) => {
    const box = list.current;
    if (box && view.current.height) view.current.anchor = { day: (box.scrollTop + y) / rowHeight(), y };
  };
  const draw = (value) => {
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
    node.toggleAttribute("data-stretched", value < min - 5e-3 || value > max + 5e-3);
    box.scrollTop = current.anchor.day * row - current.anchor.y;
    current.drawn = box.scrollTop;
    look();
  };
  const onScroll = () => {
    const box = list.current;
    if (box && Math.abs(box.scrollTop - view.current.drawn) > 0.5) {
      anchorAt(view.current.anchor.y);
      view.current.drawn = box.scrollTop;
    }
    look();
  };
  const report = (value) => {
    draw(value);
    latest.current.onDensityChange(value);
  };
  const springTo = (target, velocity = 0) => {
    const current = view.current;
    cancelAnimationFrame(current.frame);
    current.frame = 0;
    current.target = target;
    if (reducedMotion() || current.density === target) return report(target);
    let value = current.density;
    let speed = Math.max(-40, Math.min(40, velocity));
    let last = performance.now();
    const step = (now) => {
      let left = Math.min(0.064, (now - last) / 1e3);
      last = now;
      while (left > 0) {
        const h = Math.min(left, 1 / 240);
        speed += (-stiffness * (value - target) - damping * speed) * h;
        value += speed * h;
        left -= h;
      }
      const done = Math.abs(value - target) < 3e-3 && Math.abs(speed) < 0.03;
      report(done ? target : value);
      current.frame = done ? 0 : requestAnimationFrame(step);
    };
    current.frame = requestAnimationFrame(step);
  };
  const stepBy = (delta) => {
    const current = view.current;
    if (!current.frame) anchorAt(0);
    springTo(clamp((current.frame ? current.target : Math.round(current.density)) + delta, latest.current.range));
  };
  const begin = (kind, y, start = 0) => {
    cancelAnimationFrame(view.current.frame);
    view.current.frame = 0;
    anchorAt(y);
    gesture.current = { kind, from: view.current.density, raw: view.current.density, start, samples: [] };
    if (root.current) root.current.dataset.gesture = kind;
  };
  const move = (raw, y) => {
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
    const velocity = first && last && last.at > first.at ? (last.value - first.value) * 1e3 / (last.at - first.at) : 0;
    springTo(clamp(Math.round(view.current.density + velocity * projection), latest.current.range), velocity);
  };
  const viewY = (clientY) => clientY - (list.current?.getBoundingClientRect().top ?? 0);
  const onTouchStart = useEffectEvent((event) => {
    if (event.touches.length !== 2 || !event.cancelable || gesture.current) return;
    event.preventDefault();
    const [a, b] = [event.touches[0], event.touches[1]];
    begin("touch", viewY((a.clientY + b.clientY) / 2), Math.max(24, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)));
  });
  const onTouchMove = useEffectEvent((event) => {
    const current = gesture.current;
    if (current?.kind !== "touch" || event.touches.length < 2) return;
    event.preventDefault();
    const [a, b] = [event.touches[0], event.touches[1]];
    const distance = Math.max(24, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));
    move(current.from * current.start / distance, viewY((a.clientY + b.clientY) / 2));
  });
  const onTouchEnd = useEffectEvent((event) => {
    if (gesture.current?.kind === "touch" && event.touches.length < 2) end();
  });
  const onWheel = useEffectEvent((event) => {
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
  const onGesture = useEffectEvent((event) => {
    event.preventDefault();
    const current = gesture.current;
    const y = event.clientY === void 0 ? view.current.height / 2 : viewY(event.clientY);
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
  useLayoutEffect(() => {
    view.current.height = list.current?.clientHeight ?? 0;
    const { todayIndex: todayIndex2, length: length2 } = latest.current;
    view.current.anchor = { day: todayIndex2 >= 0 && todayIndex2 < length2 ? Math.max(0, todayIndex2 - 0.35) : 0, y: 0 };
    draw(view.current.density);
  }, []);
  useLayoutEffect(() => {
    if (density === view.current.density) return;
    cancelAnimationFrame(view.current.frame);
    view.current.frame = 0;
    view.current.target = density;
    anchorAt(0);
    draw(density);
  }, [density]);
  useEffect(() => {
    const box = list.current;
    const node = root.current;
    if (!box || !node) return;
    const active = { passive: false };
    const listeners = [
      [box, "touchstart", (event) => onTouchStart(event), active],
      [box, "touchmove", (event) => onTouchMove(event), active],
      [box, "touchend", (event) => onTouchEnd(event)],
      [box, "touchcancel", (event) => onTouchEnd(event)],
      [box, "scroll", () => onScroll(), { passive: true }],
      [node, "wheel", (event) => onWheel(event), active],
      [node, "gesturestart", (event) => onGesture(event), active],
      [node, "gesturechange", (event) => onGesture(event), active],
      [node, "gestureend", (event) => onGesture(event), active]
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
  }, []);
  const grip = {
    onPointerDown(event) {
      if (event.button !== 0 || gesture.current) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      begin("grip", 0, viewY(event.clientY));
    },
    onPointerMove(event) {
      const current = gesture.current;
      if (current?.kind !== "grip" || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const y = Math.max(16, Math.min(view.current.height - 16, viewY(event.clientY)));
      root.current?.style.setProperty("--pc-grip", `${y}px`);
      move(current.from * current.start / y, 0);
    },
    onLostPointerCapture() {
      root.current?.style.removeProperty("--pc-grip");
      if (gesture.current?.kind === "grip") end();
    },
    onKeyDown(event) {
      const [min, max] = latest.current.range;
      const delta = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 3, PageDown: -3 }[event.key];
      if (event.key === "Home" || event.key === "End") {
        anchorAt(0);
        springTo(event.key === "Home" ? min : max);
      } else if (delta) stepBy(delta);
      else return;
      event.preventDefault();
    }
  };
  const toToday = () => {
    const box = list.current;
    const { todayIndex: todayIndex2 } = latest.current;
    box?.scrollTo({ top: (todayIndex2 - 0.35) * rowHeight(), behavior: reducedMotion() ? "auto" : "smooth" });
  };
  const days = useMemo(() => {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
    const month = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
    const spoken = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    const byDate = /* @__PURE__ */ new Map();
    for (const event of events ?? []) byDate.set(event.date, [...byDate.get(event.date) ?? [], event]);
    const start = time(from);
    return Array.from({ length }, (_, index) => {
      const at = start + index * day;
      const date = new Date(at);
      const iso = date.toISOString().slice(0, 10);
      const number = date.getUTCDate();
      const items = byDate.get(iso);
      return /* @__PURE__ */ jsxs(
        "li",
        {
          className: "pc-day",
          "data-odd": Math.round(at / day) % 2 ? "" : void 0,
          "data-first": number === 1 ? "" : void 0,
          "data-today": iso === today ? "" : void 0,
          "aria-current": iso === today ? "date" : void 0,
          children: [
            /* @__PURE__ */ jsx("span", { className: "pc-date", "aria-hidden": "true", children: /* @__PURE__ */ jsxs("span", { className: "pc-label", children: [
              /* @__PURE__ */ jsx("span", { className: "pc-weekday", children: short(weekday.format(date)) }),
              /* @__PURE__ */ jsx("span", { className: "pc-number", children: number }),
              /* @__PURE__ */ jsx("span", { className: "pc-month", children: short(month.format(date)) })
            ] }) }),
            /* @__PURE__ */ jsx("span", { className: "pc-sr", children: spoken.format(date) }),
            items && /* @__PURE__ */ jsx("ul", { className: "pc-events", children: items.map((item, position) => /* @__PURE__ */ jsxs("li", { className: "pc-event", "data-all-day": item.time ? void 0 : "", children: [
              item.time && /* @__PURE__ */ jsx("span", { className: "pc-time", children: item.time }),
              /* @__PURE__ */ jsx("span", { className: "pc-title", children: item.title })
            ] }, position)) })
          ]
        },
        iso
      );
    });
  }, [from, length, today, locale, events]);
  const whole = Math.round(density);
  const shownAway = state === "away" ? away ?? "up" : away;
  return /* @__PURE__ */ jsxs("div", { ref: root, className: "pc", "data-state": state, "data-away": shownAway ?? void 0, children: [
    /* @__PURE__ */ jsx(
      "div",
      {
        ref: list,
        className: "pc-list",
        role: "region",
        tabIndex: 0,
        "aria-label": labels.calendar,
        onKeyDown: (event) => {
          if (event.metaKey || event.ctrlKey || event.altKey) return;
          const delta = event.key === "+" || event.key === "=" ? -1 : event.key === "-" || event.key === "_" ? 1 : 0;
          if (!delta) return;
          event.preventDefault();
          stepBy(delta);
        },
        children: /* @__PURE__ */ jsx("ol", { className: "pc-days", children: days })
      }
    ),
    /* @__PURE__ */ jsxs(
      "div",
      {
        className: "pc-grip",
        role: "slider",
        tabIndex: 0,
        "aria-orientation": "vertical",
        "aria-label": labels.density,
        "aria-valuemin": range[0],
        "aria-valuemax": range[1],
        "aria-valuenow": whole,
        "aria-valuetext": labels.days(whole),
        ...grip,
        children: [
          /* @__PURE__ */ jsx("span", { className: "pc-count", "aria-hidden": "true", children: whole }),
          /* @__PURE__ */ jsxs("svg", { className: "pc-dots", viewBox: "0 0 4 16", "aria-hidden": "true", children: [
            /* @__PURE__ */ jsx("circle", { cx: "2", cy: "2", r: "1.5" }),
            /* @__PURE__ */ jsx("circle", { cx: "2", cy: "8", r: "1.5" }),
            /* @__PURE__ */ jsx("circle", { cx: "2", cy: "14", r: "1.5" })
          ] })
        ]
      }
    ),
    /* @__PURE__ */ jsx("button", { type: "button", className: "pc-today", "aria-label": labels.today, inert: !shownAway, onClick: toToday, children: /* @__PURE__ */ jsx("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ jsx("path", { d: "M3.5 6 8 10.5 12.5 6" }) }) })
  ] });
}
export {
  PinchCalendar,
  densityRange
};
