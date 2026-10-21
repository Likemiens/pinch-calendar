import "./pinch-calendar.css";
export declare const densityRange: readonly [3, 14];
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
export declare function PinchCalendar({ from, length, today, density, onDensityChange, range, events, locale, labels, state, }: PinchCalendarProps): import("react/jsx-runtime").JSX.Element;
