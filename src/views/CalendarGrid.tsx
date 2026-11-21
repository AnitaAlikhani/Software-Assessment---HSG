import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Footprints, Globe, MessageSquare, Phone, Sparkles, UserRound, type LucideIcon } from 'lucide-react';
import type { CalendarEvent, TimeBlock } from '../types';
import { bookingSource, bookingSourceLabel, type BookingSource } from '../bookingSource';
import {
  freeSlots, hoursFromTop, isOver, layOutLanes, minutesOf, pastSpan, placeInGrid, shadedSpans, spanOf, timeOf,
  SLOT_MINUTES, type CalendarColumn, type CalendarPerson, type ColumnPlan, type SalonClock, type ShadeReason, type Span,
} from '../calendarLayout';
import { formatDate, formatDateShort, formatDayMonth, formatTimeRange, weekdayName } from '../format';
import type { StaffColor } from '../staffColors';
import { blockTitle } from '../timeBlocks';

/** How a person looks in the calendar: their colour and the short forms of their name. */
export interface PersonLook {
  person: CalendarPerson;
  color: StaffColor;
  /** The first name, with the surname's initial where two people share it: "Anna", "Anna W.". */
  shortName: string;
  initials: string;
}

// A person for "by hand", not a pencil: on an appointment a pencil would read as "edit".
const SOURCE_ICONS: Record<BookingSource, LucideIcon> = {
  ai: Sparkles,
  chat: MessageSquare,
  'booking-page': Globe,
  phone: Phone,
  'walk-in': Footprints,
  manual: UserRound,
};

/** How an appointment was booked, as a small icon that carries its meaning as a name. */
export const SourceIcon: React.FC<{ event: Pick<CalendarEvent, 'id' | 'isAiBooked' | 'conversationId' | 'source'>; className?: string }> = ({ event, className = 'h-3 w-3' }) => {
  const source = bookingSource(event);
  const Icon = SOURCE_ICONS[source];
  const label = bookingSourceLabel(source);
  return (
    <span role="img" aria-label={label} title={label} data-source={source} className="inline-flex shrink-0">
      <Icon className={className} aria-hidden="true" />
    </span>
  );
};

/** The one label of a column in which nothing can be added all day. */
const SHADE_LABELS: Record<ShadeReason, string> = {
  closed: 'Closed',
  away: 'Away',
  off: 'Not working',
  nobody: 'Nobody is working',
};

/**
 * The day of the month as the app's dates write it ("05" of "05.10."), for a tile that is too
 * narrow for the month: the week's dates stand beside or above it.
 */
export const dayOfMonth = (date: string): string => formatDayMonth(date).split('.')[0];

/** "Christian" of "Christian Hungerbühler", and "CH": what a narrow appointment has room for. */
export const firstNameOf = (name: string): string => name.trim().split(/\s+/)[0] ?? '';
export const initialsOfName = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

/**
 * Everything about an appointment in one sentence. A narrow block shows only a time and
 * initials, so this is what a screen reader says and what the pointer shows on hover.
 */
export const appointmentSummary = (event: CalendarEvent): string =>
  `${event.serviceName}, ${formatDate(event.date, { weekday: 'long' })}, ${formatTimeRange(event.startTime, event.endTime)}, with ${event.staffName}. ${bookingSourceLabel(bookingSource(event))}.`;

/** Everything about a time block in one sentence, for a screen reader and the pointer. */
export const timeBlockSummary = (block: TimeBlock, staffName: string): string =>
  `${blockTitle(block)}, ${staffName}, ${formatDate(block.date, { weekday: 'long' })}, ${formatTimeRange(block.startTime, block.endTime)}${block.reason === 'Other' || !block.note?.trim() ? '' : `. ${block.note.trim()}`}`;

/**
 * How a time block looks: grey stripes, so it reads as time that is kept free and never as an
 * appointment. The stylist's colour stays as a thin edge on the left.
 */
export const BLOCK_STRIPES = 'repeating-linear-gradient(135deg, #f8fafc 0 5px, #e2e8f0 5px 7px)';

/** A position in the grid as CSS: hours times the height the screen gives to one hour. */
const hours = (value: number): string => `calc(var(--cal-hour) * ${Number(value.toFixed(4))})`;

/** What the grid draws in a column: an appointment or a time block. */
type Placed = { event: CalendarEvent; block?: undefined } | { block: TimeBlock; event?: undefined };

interface CalendarGridProps {
  /** "day": one column per stylist. "week": one column per day. */
  mode: 'day' | 'week';
  /**
   * The week on a phone: seven columns are too narrow for text, so the week is a picture of
   * who is busy when, and a tap on a day opens that day.
   */
  overview?: boolean;
  columns: CalendarColumn<CalendarEvent>[];
  /** The stretch of the day the grid shows. */
  grid: Span;
  /** The salon's date and time at this moment. */
  now: SalonClock;
  lookOf: (event: CalendarEvent) => PersonLook;
  lookOfPerson: (person: CalendarPerson) => PersonLook;
  /** The look of the stylist a time block belongs to. */
  lookOfBlock?: (block: TimeBlock) => PersonLook;
  /** A click on a time block: the owner changes or removes it. */
  onOpenBlock?: (block: TimeBlock) => void;
  /** Week view: the short names of the people who are away on a date. */
  awayOn?: (date: string) => string[];
  selectedEventId: string | null;
  /** False while no appointment can be added at all (no service, nobody in the team). */
  canAdd: boolean;
  onOpenEvent: (event: CalendarEvent) => void;
  onAdd: (date: string, time: string, employeeId?: string) => void;
  /** Week view: a click on a day's heading opens that day. */
  onOpenDay?: (date: string) => void;
  /**
   * Day view on a phone, where the headings of the columns are the legend: a tap on a stylist
   * shows only their column, a second tap shows everybody's again. `chosenKey` is the stylist shown alone.
   */
  onTogglePerson?: (key: string) => void;
  chosenKey?: string;
  /** Counts up whenever the current time should be brought into view again ("Today"). */
  scrollSignal?: number;
}

/**
 * The time grid: appointments drawn to scale by start and length, side by side where they
 * overlap, on a grid with a line every half hour.
 *
 * The grid scrolls inside its own frame and fills the rest of the screen, so the controls above
 * it and the headings of its columns stay in view. Every vertical position is a number of hours
 * times --cal-hour, the height of one hour, which is larger on touch screens: half an hour is
 * then 44 px tall, enough to tap.
 */
export const CalendarGrid: React.FC<CalendarGridProps> = ({
  mode, overview = false, columns, grid, now, lookOf, lookOfPerson, lookOfBlock, onOpenBlock, awayOn, selectedEventId, canAdd, onOpenEvent, onAdd, onOpenDay,
  onTogglePerson, chosenKey, scrollSignal = 0,
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

  const hourMarks = Array.from({ length: Math.round((grid.end - grid.start) / 60) }, (_, index) => grid.start + index * 60);
  const nowMinute = minutesOf(now.time);
  const todayShown = columns.some((column) => column.date === now.date);
  const nowTop = todayShown && nowMinute !== null && nowMinute > grid.start && nowMinute < grid.end ? hoursFromTop(nowMinute, grid) : null;
  // On opening, the current time stands an hour below the top edge: a little of what was, most of what comes.
  const anchorTop = nowTop === null ? null : Math.max(0, nowTop - 1);
  // The day view of a day that is over: its hours are muted in the margin too.
  const mutedBefore = mode === 'day' && columns[0] ? (pastSpan(columns[0].date, now, grid)?.end ?? grid.start) : grid.start;

  // The frame ends just above the bottom of the screen. Where it starts depends on what stands
  // above it (controls that wrap, a note, a banner), so that is measured: after every drawing,
  // and whenever the window or the page around the grid changes its size (a font that arrives late).
  const measure = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.style.setProperty('--cal-top', `${Math.round(scroller.getBoundingClientRect().top + window.scrollY)}px`);
    scroller.style.setProperty('--cal-head', `${headRef.current?.offsetHeight ?? 0}px`);
  };
  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener('resize', measure);
    const page = scrollerRef.current?.parentElement;
    const observer = page && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (page) observer?.observe(page);
    return () => { window.removeEventListener('resize', measure); observer?.disconnect(); };
  }, []);

  // When the grid appears, and on "Today", the current time is scrolled into view. Between the
  // day and the week the grid keeps its place: who looks at the afternoon goes on looking at it.
  // (The week on a phone has a scale of its own, so it finds its place anew.)
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const anchor = scroller.querySelector<HTMLElement>('[data-scroll-anchor]');
    scroller.scrollTop = anchor ? anchor.offsetTop : 0;
  }, [overview, scrollSignal]);

  const template = { gridTemplateColumns: `repeat(${columns.length}, minmax(${mode === 'day' ? 'var(--cal-col)' : '0px'}, 1fr))` };
  // Header and body share one width, also when a day has more stylists than fit side by side.
  const rowWidth = { minWidth: mode === 'day' ? `calc(var(--cal-gutter) + ${columns.length} * var(--cal-col))` : undefined };

  const planLabel = (plan: ColumnPlan): string => plan.reason ? SHADE_LABELS[plan.reason] : '';

  const columnHeading = (column: CalendarColumn<CalendarEvent>) => {
    const isToday = column.date === now.date;
    const count = column.events.length;
    const countText = count === 0 ? 'no appointments' : `${count} ${count === 1 ? 'appointment' : 'appointments'}`;
    if (column.person) {
      const look = lookOfPerson(column.person);
      const hoursText = column.plan.open ? formatTimeRange(timeOf(column.plan.open.start), timeOf(column.plan.open.end)) : planLabel(column.plan);
      const heading = (
        <>
          <span aria-hidden="true" className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold md:flex" style={{ backgroundColor: look.color.fill, color: look.color.ink, boxShadow: `inset 0 0 0 1.5px ${look.color.accent}` }}>{look.initials}</span>
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-900 md:text-sm">
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full md:hidden" style={{ backgroundColor: look.color.accent }} />
              <span className="truncate md:hidden">{look.shortName}</span><span className="hidden truncate md:inline">{column.person.name}</span>
            </span>
            <span className="block truncate text-[11px] tabular-nums text-slate-500">{hoursText}<span className="hidden md:inline"> · {countText}</span></span>
          </span>
        </>
      );
      const headingClass = 'flex min-w-0 items-center gap-2 border-l border-slate-200/70 px-1.5 py-2 text-left first:border-l-0 md:px-3';
      if (!onTogglePerson) return <div key={column.key} data-person={column.key} className={headingClass}>{heading}</div>;
      const chosen = chosenKey === column.key;
      return (
        <button key={column.key} type="button" data-person={column.key} data-stylist={column.key} aria-pressed={chosen} aria-label={`Only ${column.person.name}`}
          onClick={() => onTogglePerson(column.key)}
          className={`${headingClass} min-h-11 transition-colors active:bg-slate-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5551FF]`}
          style={chosen ? { backgroundColor: look.color.fill } : undefined}>
          {heading}
        </button>
      );
    }
    // Why the whole column is shaded is said once, by the label inside the column. The heading
    // only turns pale, and says it to a screen reader.
    const closedText = planLabel(column.plan);
    if (mode === 'day') {
      // A closed day, or a day on which nobody works: one column for everybody.
      return (
        <div key={column.key} data-date={column.date} className="min-w-0 px-3 py-2">
          <span className="block truncate text-sm font-semibold text-slate-900">{formatDate(column.date, { weekday: 'long' })}</span>
          <span className="block truncate text-[11px] text-slate-500">{count > 0 ? countText : <>&nbsp;</>}</span>
        </div>
      );
    }
    const away = awayOn?.(column.date) ?? [];
    const spoken = [formatDate(column.date, { weekday: 'long' }), isToday ? 'today' : '', closedText ? closedText.toLowerCase() : '', countText,
      away.length ? `${away.join(' and ')} away` : ''].filter(Boolean).join(', ');
    return (
      <button key={column.key} type="button" data-date={column.date} aria-current={isToday ? 'date' : undefined}
        aria-label={`${spoken}. Open this day`} onClick={() => onOpenDay?.(column.date)}
        className={`group/day min-w-0 cursor-pointer border-l border-slate-200/70 px-1 py-1.5 text-center first:border-l-0 hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5551FF] ${overview ? 'min-h-11' : ''} ${isToday ? 'bg-indigo-50/60' : ''}`}>
        {overview ? (
          <>
            <span className={`block text-[10px] font-semibold uppercase leading-none ${isToday ? 'text-[#5551FF]' : 'text-slate-500'}`}>{weekdayName(column.date, 'short')}</span>
            <span className={`mx-auto mt-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold leading-none tabular-nums ${isToday ? 'bg-[#5551FF] text-white' : closedText ? 'text-slate-500' : 'text-slate-900'}`}>{dayOfMonth(column.date)}</span>
          </>
        ) : (
          <>
            <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${isToday ? 'bg-[#5551FF] text-white' : closedText ? 'text-slate-500' : 'text-slate-900 group-hover/day:text-[#5551FF]'}`}>{formatDateShort(column.date)}</span>
            <span className={`mt-0.5 block truncate text-[11px] ${isToday ? 'font-semibold text-[#5551FF]' : 'text-slate-500'}`}>{isToday ? (count > 0 ? `Today · ${count}` : 'Today') : count > 0 ? countText : <>&nbsp;</>}</span>
            {away.length > 0 && <span className="block truncate text-[10px] text-slate-500" title={`${away.join(', ')} away`}>{away.join(', ')} away</span>}
          </>
        )}
      </button>
    );
  };

  const columnBody = (column: CalendarColumn<CalendarEvent>) => {
    const isToday = column.date === now.date;
    const past = pastSpan(column.date, now, grid);
    const pastPlace = past ? placeInGrid(past, grid) : null;
    // A stylist's blocked time takes no click for an appointment. In the week for everybody a
    // place belongs to nobody, so others can still be booked beside a block.
    const blocked = column.person || chosenKey ? column.blocks.map((block) => spanOf(block.startTime, block.endTime)).filter((span) => span !== null) : [];
    const slots = canAdd && !overview ? freeSlots(column.plan.open, column.date, now, blocked) : [];
    const lookOfItem = (item: Placed): PersonLook => item.event ? lookOf(item.event)
      : lookOfBlock?.(item.block) ?? lookOfPerson({ key: item.block.employeeId, employeeId: item.block.employeeId, name: '', index: -1 });
    // Blocks stand in their stylist's lane beside the appointments, so neither covers the other.
    const items: Placed[] = [...column.events.map((event) => ({ event })), ...column.blocks.map((block) => ({ block }))];
    const laned = layOutLanes(items, (item) => item.event ? spanOf(item.event.startTime, item.event.endTime) : spanOf(item.block.startTime, item.block.endTime), {
      groupOf: (item) => lookOfItem(item).person.key,
      rankOf: (item) => { const index = lookOfItem(item).person.index; return index < 0 ? Number.MAX_SAFE_INTEGER : index; },
    });
    // In the week a strip at the right edge of every day stays free, so a click can still add
    // an appointment beside one that fills the day's width.
    const edge = mode === 'week' && !overview ? 8 : 0;
    const label = column.plan.open === null ? planLabel(column.plan) : '';
    const spoken = [column.person ? column.person.name : formatDate(column.date, { weekday: 'long' }), label ? label.toLowerCase() : ''].filter(Boolean).join(', ');
    return (
      <div key={column.key} role="group" aria-label={spoken} data-column={column.key} data-date={column.date}
        onClick={overview ? () => onOpenDay?.(column.date) : undefined}
        className={`relative min-w-0 border-l border-slate-200/70 first:border-l-0 ${overview ? 'cursor-pointer' : ''} ${isToday && mode === 'week' ? 'bg-indigo-50/40' : ''}`}>
        {pastPlace && <div aria-hidden="true" data-past="" className="pointer-events-none absolute inset-x-0 bg-slate-100/60" style={{ top: hours(pastPlace.top), height: hours(pastPlace.height) }} />}
        {shadedSpans(column.plan.open, grid).map((span) => {
          const place = placeInGrid(span, grid)!;
          return <div key={span.start} aria-hidden="true" data-shaded="" className="pointer-events-none absolute inset-x-0 bg-slate-200/55" style={{ top: hours(place.top), height: hours(place.height) }} />;
        })}
        {slots.map((start) => {
          const time = timeOf(start);
          return (
            // A place for the pointer and the finger only. With the keyboard, "Add" opens the same form.
            <div key={start} data-slot={time} onClick={() => onAdd(column.date, time, column.person?.employeeId)}
              className="group/slot absolute inset-x-0 cursor-pointer active:bg-indigo-100/70 [@media(hover:hover)]:hover:bg-indigo-100/50"
              style={{ top: hours(hoursFromTop(start, grid)), height: hours(SLOT_MINUTES / 60) }}>
              <span aria-hidden="true" className="pointer-events-none hidden h-full items-center px-2 text-[11px] font-semibold tabular-nums text-[#5551FF] [@media(hover:hover)]:group-hover/slot:flex">+ {time}</span>
            </div>
          );
        })}
        {label && (
          <p data-shade-label="" className={`pointer-events-none sticky z-[12] mx-auto w-fit max-w-[calc(100%-0.5rem)] rounded-full bg-white/85 text-center font-semibold text-slate-500 ring-1 ring-slate-200 ${overview ? 'px-0.5 py-2 text-[10px] [writing-mode:vertical-rl]' : 'px-2.5 py-1 text-[11px]'}`}
            style={{ top: 'calc(var(--cal-head, 3.5rem) + 0.75rem)', marginTop: '0.75rem' }}>
            {label}{column.plan.note && !overview && <span className="block truncate font-normal">{column.plan.note}</span>}
          </p>
        )}
        {laned.map(({ item, span, lane, lanes, width }) => {
          const place = placeInGrid(span, grid);
          if (!place) return null;
          const left = `calc((100% - ${edge}px) * ${Number((lane / lanes).toFixed(4))} + 1px)`;
          const wide = `calc((100% - ${edge}px) * ${Number((width / lanes).toFixed(4))} - 2px)`;
          if (item.block) {
            const block = item.block;
            const look = lookOfItem(item);
            const box = { top: `calc(${hours(place.top)} + 1px)`, height: `calc(${hours(place.height)} - 2px)`, left, width: wide };
            if (overview) {
              return <span key={block.id} aria-hidden="true" data-bar-block={block.id} className="absolute rounded-[3px] ring-1 ring-inset ring-slate-300"
                style={{ ...box, backgroundImage: BLOCK_STRIPES }} />;
            }
            const summary = timeBlockSummary(block, look.person.name);
            const minutes = span.end - span.start;
            return (
              <button key={block.id} type="button" data-block={block.id}
                aria-label={`Change blocked time: ${summary}`} title={`Blocked: ${summary}`}
                onClick={(click) => { click.stopPropagation(); onOpenBlock?.(block); }}
                className={`@container absolute z-10 flex cursor-pointer overflow-hidden rounded-md px-0.5 py-0.5 text-left leading-[1.2] text-slate-600 ring-1 ring-inset ring-slate-300 transition-shadow hover:z-20 hover:shadow-md focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5551FF] @[2.75rem]:px-1 @[4rem]:px-1.5 ${minutes < 30 ? 'flex-row items-center gap-1.5' : 'flex-col'}`}
                style={{ ...box, backgroundColor: '#f1f5f9', backgroundImage: BLOCK_STRIPES, borderLeft: `3px solid ${look.color.accent}` }}>
                <span className="shrink-0 truncate text-[10px] font-semibold tabular-nums @[2.75rem]:text-[11px]">
                  <span className="@[7rem]:hidden">{block.startTime}</span>
                  <span className="hidden @[7rem]:inline">{formatTimeRange(block.startTime, block.endTime)}</span>
                </span>
                <span className="min-w-0 truncate rounded-sm text-[11px] font-bold text-slate-700 @[2.75rem]:text-xs">
                  <span className="bg-slate-50/90 [box-decoration-break:clone]">{blockTitle(block)}</span>
                </span>
                {!column.person && minutes >= 60 && <span className="hidden min-w-0 truncate text-[11px] @[2.75rem]:block"><span className="bg-slate-50/90">{look.shortName}</span></span>}
              </button>
            );
          }
          const event = item.event;
          const look = lookOf(event);
          const over = isOver(event, now);
          if (overview) {
            return <span key={event.id} aria-hidden="true" data-bar={event.id} className="absolute rounded-[3px]"
              style={{ top: `calc(${hours(place.top)} + 1px)`, height: `calc(${hours(place.height)} - 2px)`, left, width: wide, backgroundColor: over ? look.color.pastAccent : look.color.accent }} />;
          }
          const minutes = span.end - span.start;
          const first = firstNameOf(event.customerName);
          return (
            <button key={event.id} type="button" data-event={event.id}
              aria-label={`Open appointment for ${event.customerName}: ${appointmentSummary(event)}`}
              title={`${event.customerName} · ${event.serviceName} · ${formatTimeRange(event.startTime, event.endTime)} · ${event.staffName}`}
              onClick={(click) => { click.stopPropagation(); onOpenEvent(event); }}
              className={`@container absolute z-10 flex cursor-pointer overflow-hidden rounded-md px-0.5 py-0.5 text-left leading-[1.2] transition-shadow hover:z-20 hover:shadow-md focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5551FF] @[2.75rem]:px-1 @[4rem]:px-1.5 ${minutes < 30 ? 'flex-row items-center gap-1.5' : 'flex-col'} ${event.id === selectedEventId ? 'z-20 ring-2 ring-[#5551FF]' : ''}`}
              style={{
                top: `calc(${hours(place.top)} + 1px)`, height: `calc(${hours(place.height)} - 2px)`, left, width: wide,
                backgroundColor: over ? look.color.pastFill : look.color.fill, color: over ? look.color.pastInk : look.color.ink,
                borderLeft: `3px solid ${over ? look.color.pastAccent : look.color.accent}`,
              }}>
              <span className="flex min-w-0 shrink-0 items-center justify-between gap-1">
                <span className="truncate text-[10px] font-semibold tabular-nums @[2.75rem]:text-[11px]">
                  {/* Start and end where they fit, else the start alone. */}
                  <span className="@[7rem]:hidden">{event.startTime}</span>
                  <span className="hidden @[7rem]:inline">{formatTimeRange(event.startTime, event.endTime)}</span>
                  {minutes < 60 && <span className="hidden font-normal @[13rem]:inline"> · {event.serviceName}</span>}
                </span>
                <span className="hidden opacity-60 @[4.25rem]:inline-flex"><SourceIcon event={event} className="h-[11px] w-[11px]" /></span>
              </span>
              {/* The full name where it fits, else the first name, else the initials. */}
              <span className="min-w-0 truncate text-[11px] font-bold @[2.75rem]:text-xs">
                <span className="@[2.75rem]:hidden">{initialsOfName(event.customerName)}</span>
                <span className="hidden @[2.75rem]:inline @[6.5rem]:hidden">{first}</span>
                <span className="hidden @[6.5rem]:inline">{event.customerName}</span>
              </span>
              {minutes >= 60 && (
                <span className="hidden min-w-0 truncate text-[11px] opacity-80 @[2.75rem]:block">
                  {event.serviceName}{!column.person && <span className="hidden @[6.5rem]:inline"> · {look.shortName}</span>}
                </span>
              )}
            </button>
          );
        })}
        {mode === 'week' && isToday && nowTop !== null && (
          <div aria-hidden="true" data-now="" className="pointer-events-none absolute inset-x-0 z-[15] border-t-2 border-rose-500" style={{ top: hours(nowTop) }}>
            {!overview && <span className="absolute -left-[5px] -top-[5px] h-2 w-2 rounded-full bg-rose-500" />}
          </div>
        )}
      </div>
    );
  };

  return (
    // A region of its own that the keyboard can scroll, also on a day without appointments to tab to.
    // "isolate": what is layered inside the grid (headings over hours over appointments) stays
    // inside it, below the app's top bar and the search results that can lie over the page.
    <div ref={scrollerRef} data-calendar-grid={mode} role="region" aria-label="Appointments by time of day" tabIndex={0}
      className={`relative isolate overflow-auto rounded-2xl border border-slate-200/80 bg-white shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF] [--cal-bottom:calc(4.75rem+env(safe-area-inset-bottom))] [--cal-gutter:2.5rem] md:[--cal-gutter:3rem] lg:[--cal-bottom:1.5rem] ${
        overview ? '[--cal-hour:2.25rem]' : '[--cal-col:5.25rem] [--cal-hour:5.75rem] md:[--cal-col:9rem] md:[--cal-hour:4.5rem] md:pointer-coarse:[--cal-hour:5.75rem]'
      }`}
      style={{ maxHeight: 'max(18rem, calc(100dvh - var(--cal-top, 16rem) - var(--cal-bottom)))' }}>
      {/* The headings of the columns stay in view while the hours scroll. */}
      <div ref={headRef} className="sticky top-0 z-30 flex border-b border-slate-200 bg-white" style={rowWidth}>
        {/* The corner names the day of the day view, so the day stays in view with its columns. */}
        <div data-grid-corner="" className="sticky left-0 z-10 flex w-[var(--cal-gutter)] shrink-0 flex-col items-center justify-center gap-0.5 border-r border-slate-200/70 bg-white">
          {mode === 'day' && columns[0] && (
            <>
              <span className={`text-[10px] font-semibold uppercase leading-none ${columns[0].date === now.date ? 'text-[#5551FF]' : 'text-slate-500'}`}>{weekdayName(columns[0].date, 'short')}</span>
              <span className={`text-sm font-bold leading-none tabular-nums ${columns[0].date === now.date ? 'text-[#5551FF]' : 'text-slate-900'}`}>{dayOfMonth(columns[0].date)}</span>
            </>
          )}
        </div>
        <div className="grid min-w-0 flex-1" style={template}>{columns.map(columnHeading)}</div>
      </div>

      <div className="relative flex" style={{ height: hours((grid.end - grid.start) / 60), ...rowWidth }}>
        {/* The hours in the margin, each at its line. */}
        <div className="sticky left-0 z-20 w-[var(--cal-gutter)] shrink-0 border-r border-slate-200/70 bg-white">
          {hourMarks.map((minute) => {
            // The current time takes the place of an hour's label that it would lie over. In the
            // week on a phone an hour is short, so the label is in the way for longer.
            const sinceHour = nowTop !== null && nowMinute !== null ? nowMinute - minute : null;
            const hidden = sinceHour !== null && sinceHour > (overview ? -12 : -8) && sinceHour < (overview ? 42 : 24);
            return (
              <span key={minute} className={`absolute right-1.5 text-[11px] font-medium tabular-nums md:right-2 ${hidden ? 'invisible' : minute + 60 <= mutedBefore ? 'text-slate-400' : 'text-slate-600'}`}
                style={{ top: `calc(${hours(hoursFromTop(minute, grid))} + 3px)` }}>{timeOf(minute)}</span>
            );
          })}
          {nowTop !== null && (
            <span data-now-time="" className="absolute right-0.5 z-10 -translate-y-1/2 rounded bg-rose-500 px-1 py-px text-[10px] font-bold tabular-nums text-white md:right-1" style={{ top: hours(nowTop) }}>
              <span className="sr-only">Now </span>{now.time}
            </span>
          )}
        </div>
        <div className="relative grid min-w-0 flex-1" style={{
          ...template,
          // A line at every hour and a fainter one at every half hour.
          backgroundImage: 'linear-gradient(to bottom, #e2e8f0 1px, transparent 1px), linear-gradient(to bottom, #f1f5f9 1px, transparent 1px)',
          backgroundSize: '100% var(--cal-hour), 100% calc(var(--cal-hour) / 2)',
        }}>
          {columns.map(columnBody)}
          {mode === 'day' && nowTop !== null && (
            <div aria-hidden="true" data-now="" className="pointer-events-none absolute inset-x-0 z-[15] border-t-2 border-rose-500" style={{ top: hours(nowTop) }} />
          )}
        </div>
        {anchorTop !== null && <div aria-hidden="true" data-scroll-anchor="" className="pointer-events-none absolute left-0 h-px w-px" style={{ top: hours(anchorTop) }} />}
      </div>
    </div>
  );
};
