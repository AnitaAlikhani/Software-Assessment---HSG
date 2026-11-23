import React, { useId, useState } from 'react';
import { axisTicks, type Period } from '../analytics';
import type { CurveMoment, CurvePoint, MonthCurve, WeekDay } from '../dashboard';
import { formatDate, formatDayMonth, formatMoney, formatMonth, weekdayName } from '../format';
import { addDays } from '../scheduling';

/**
 * Home's pictures of its figures: a share as a bar, the week as seven bars, the month as a line.
 *
 * Each of them shows a number the page also says in words. The bars and lines are hidden from a
 * screen reader, which gets the words; a sighted reader gets both. Scales are drawn, not written
 * into the page (see `Tick`), so a copy of the page's text holds the figures once.
 */

const BRAND = '#5551FF';
/**
 * The month before: grey, so the current month is the line the eye follows. Still dark enough to
 * stand 3:1 against the card, and far from the brand colour for red-green colour blindness too;
 * the legend names both lines, so colour is never the only sign.
 */
const BEFORE = '#8492a6';

// ---------- a share as a bar ----------

/**
 * A share as a bar: the fill on a paler track of the same colour. It is the picture of a number
 * that stands beside it in words. `ai` is the colour of what the AI receptionist brought in.
 */
export const Meter = ({ share, tone = 'brand', className = '' }: { share: number; tone?: 'brand' | 'ai'; className?: string }) => {
  const width = Math.max(0, Math.min(100, share));
  return (
    <span aria-hidden="true" className={`block h-1.5 overflow-hidden rounded-full ${tone === 'ai' ? 'bg-amber-100' : 'bg-[#5551FF]/12'} ${className}`}>
      {/* A share of one or two per cent is still a share: it keeps the width of a dot. */}
      {width > 0 && <span className={`block h-full min-w-1.5 rounded-full ${tone === 'ai' ? 'bg-amber-500' : 'bg-[#5551FF]'}`} style={{ width: `${width}%` }} />}
    </span>
  );
};

/** A number on a chart's scale. It is drawn by the style sheet: the page's text holds no row of loose numbers. */
const Tick = ({ label, className, style }: { label: string; className: string; style?: React.CSSProperties }) => (
  <span aria-hidden="true" data-tick={label} style={style} className={`pointer-events-none absolute whitespace-nowrap text-[10px] leading-none tabular-nums text-slate-500 before:content-[attr(data-tick)] ${className}`} />
);

// ---------- the week as seven bars ----------

interface WeekBarsProps {
  days: WeekDay[];
  /** True when the days are the owner's own: the words then say "your working hours". */
  mine?: boolean;
  /** Opens a day in the calendar. Left out, the days are no buttons. */
  onOpenDay?: (date: string) => void;
}

/**
 * The days of the week side by side, each a bar that fills with the share of its working hours
 * that is booked. A low bar on a day to come is room for a booking. Today is the strong bar,
 * days that are over are grey. A closed day has no bar: it has no hours to fill.
 *
 * Pointing at a day or moving to it with the keyboard shows its date and its appointments; with
 * `onOpenDay` a day is a button that opens it in the calendar.
 */
export const WeekBars: React.FC<WeekBarsProps> = ({ days, mine = false, onOpenDay }) => {
  const [active, setActive] = useState<number | null>(null);
  const captionId = useId();
  const hours = mine ? 'your working hours' : 'working hours';
  /** A day in a few words: what a screen reader hears, and what the label over the day shows. */
  const inWords = (day: WeekDay): string => {
    const count = `${day.appointments === 0 ? 'no' : day.appointments} ${day.appointments === 1 ? 'appointment' : 'appointments'}`;
    if (day.closed) return `closed${day.closed.name ? ` (${day.closed.name})` : ''}${day.appointments > 0 ? `, ${count} all the same` : ''}`;
    return day.share === null ? `${mine ? 'you do not work' : 'nobody works'}, ${count}` : `${day.share}% of ${hours} booked, ${count}`;
  };

  return (
    <div>
      <div role="group" aria-labelledby={captionId} className="flex items-stretch gap-0.5 sm:gap-1">
        {days.map((day, index) => {
          const today = day.when === 'today';
          const fill = today ? 'bg-[#5551FF]' : day.when === 'past' ? 'bg-slate-300' : 'bg-[#5551FF]/45';
          const shown = active === index;
          const parts = (
            <>
              <span aria-hidden="true" className={`h-4 text-xs font-semibold tabular-nums ${today ? 'text-[#433fd8]' : day.when === 'past' ? 'text-slate-500' : 'text-slate-700'}`}>
                {day.share === null ? '' : `${day.share}%`}
              </span>
              <span aria-hidden="true" className="flex h-24 w-full items-end justify-center">
                {day.share === null ? (
                  <span className="pb-0.5 text-[11px] font-medium text-slate-500">{day.closed ? 'Closed' : 'Off'}</span>
                ) : (
                  // The track is the whole of the day's working hours; the bar fills it from the foot.
                  <span className={`flex h-full w-5 items-end overflow-hidden rounded-t-[4px] bg-slate-100 transition-colors ${shown ? 'bg-slate-200' : ''}`}>
                    {day.share > 0 && <span className={`w-full min-h-0.5 rounded-t-[4px] ${fill}`} style={{ height: `${Math.min(100, day.share)}%` }} />}
                  </span>
                )}
              </span>
              <span aria-hidden="true" className={`mt-0.5 text-xs font-semibold ${today ? 'text-[#433fd8]' : 'text-slate-700'}`}>{weekdayName(day.date, 'short')}</span>
              <span aria-hidden="true" className={`text-[11px] tabular-nums ${today ? 'font-semibold text-[#433fd8]' : 'text-slate-500'}`}>{today ? 'Today' : formatDayMonth(day.date)}</span>
              <span className="sr-only">{formatDate(day.date, { weekday: 'long' })}: {inWords(day)}.</span>
              {shown && (
                <span
                  aria-hidden="true"
                  // Over the first days the label starts at the day's edge, over the last it ends there: it stays inside the card.
                  className={`pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-[11px] leading-snug shadow-md ${
                    index < 2 ? 'left-0' : index > days.length - 3 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                  }`}
                >
                  <span className="block font-bold text-slate-900">{formatDate(day.date)}</span>
                  <span className="block text-slate-600">{inWords(day).replace(/^./, (letter) => letter.toUpperCase())}</span>
                </span>
              )}
            </>
          );
          const frame = `relative flex min-w-0 flex-1 flex-col items-center rounded-xl px-0.5 pb-1.5 pt-2 ${today ? 'bg-[#5551FF]/6' : ''}`;
          const point = {
            onPointerEnter: (event: React.PointerEvent) => { if (event.pointerType === 'mouse') setActive(index); },
            onPointerLeave: (event: React.PointerEvent) => { if (event.pointerType === 'mouse') setActive(null); },
          };
          return onOpenDay ? (
            <button
              key={day.date} type="button" {...point}
              onFocus={() => setActive(index)} onBlur={() => setActive(null)}
              onClick={() => onOpenDay(day.date)}
              className={`${frame} min-h-11 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF] ${today ? 'hover:bg-[#5551FF]/10' : ''}`}
            >
              {parts}<span className="sr-only"> Open the day in the calendar.</span>
            </button>
          ) : <div key={day.date} {...point} className={frame}>{parts}</div>;
        })}
      </div>
      <p id={captionId} className="mt-2 text-xs text-slate-500">Share of {hours} booked, day by day</p>
    </div>
  );
};

// ---------- the month as a line ----------

/** The chart's scale reaches to the end of the longest month, so the same day of two months stands at the same place. */
const SCALE_DAYS = 31;

const LegendKey = ({ children, color, dotted = false }: { children: React.ReactNode; color: string; dotted?: boolean }) => (
  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
    <span aria-hidden="true" className={`inline-block w-4 ${dotted ? 'border-t-2 border-dotted' : 'h-0.5 rounded-full'}`} style={dotted ? { borderColor: color } : { backgroundColor: color }} />
    {children}
  </span>
);

interface PaceChartProps {
  curve: MonthCurve;
  /** The current month, first to last day. */
  month: Period;
  className?: string;
}

/**
 * The month as a line: what its appointments are worth at list prices, added up day by day.
 * The solid line, under the month's name, is what has taken place, up to this minute. The
 * dotted line carries on with what is already in the calendar for the days to come: bookings,
 * no forecast. The grey line is the month before, with a dot where it stood at the same point:
 * the distance between the two dots is the change the figure beside the chart names.
 *
 * Pointing at the chart, tapping it or using the arrow keys reads a day.
 */
export const PaceChart: React.FC<PaceChartProps> = ({ curve, month, className = '' }) => {
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();
  const helpId = useId();
  const { days, now, before } = curve;
  const lastDay = days.length;
  const today = Math.min(lastDay, Math.floor(now.at) + 1);
  const name = formatMonth(month.from).split(' ')[0];
  const beforeName = before ? formatMonth(before.month.from).split(' ')[0] : '';
  const ticks = axisTicks(Math.max(days[lastDay - 1]?.value ?? 0, before?.days[before.days.length - 1]?.value ?? 0));
  const top = ticks[ticks.length - 1];

  const x = (at: number) => at / SCALE_DAYS * 100;
  const y = (value: number) => value / top * 100;
  const path = (points: CurveMoment[]) => points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.at).toFixed(2)} ${(100 - y(point.value)).toFixed(2)}`).join(' ');
  const ends = (points: CurvePoint[]): CurveMoment[] => points.map((point) => ({ at: point.day, value: point.value }));
  // What has taken place: the days that are over, then this minute. What is booked ahead: from this minute on.
  const soFar: CurveMoment[] = [{ at: 0, value: 0 }, ...ends(days.filter((point) => point.day < today)), now];
  const ahead: CurveMoment[] = [now, ...ends(days.filter((point) => point.day >= today))];

  const amount = (value: number) => formatMoney(value).replace(/^\S+ /, '').replace(/\.00$/, '');
  const dateOf = (day: number) => addDays(month.from, day - 1);
  /** What the two months had reached by a day: for today, what has taken place so far. */
  const read = (day: number) => ({
    value: day === today ? now.value : days[day - 1].value,
    before: before ? before.days[Math.min(day, before.days.length) - 1].value : null,
  });
  const describe = (day: number): string => {
    const at = read(day);
    const here = day === today ? `Today so far: ${formatMoney(at.value)} booked in ${name}`
      : `By the end of ${formatDate(dateOf(day))}: ${formatMoney(at.value)} booked in ${name}${day > today ? ', with what is booked ahead' : ''}`;
    return `${here}${at.before === null ? '' : `, ${formatMoney(at.before)} booked in ${beforeName} by the same day`}.`;
  };
  const move = (event: React.KeyboardEvent) => {
    const next = event.key === 'ArrowRight' ? Math.min(lastDay, (active ?? today - 1) + 1)
      : event.key === 'ArrowLeft' ? Math.max(1, (active ?? today + 1) - 1)
      : event.key === 'Home' ? 1 : event.key === 'End' ? lastDay : event.key === 'Escape' ? null : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  };
  const dayAt = (event: React.PointerEvent | React.MouseEvent): number => {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.max(1, Math.min(lastDay, Math.ceil((event.clientX - box.left) / box.width * SCALE_DAYS)));
  };
  const shown = active === null ? null : { day: active, at: active === today ? now.at : active, ...read(active) };

  return (
    <figure className={className}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
        <span id={titleId} className="text-[13px] font-semibold text-slate-800">Booked value by day</span>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
          <LegendKey color={BRAND}>{name}</LegendKey>
          {before && <LegendKey color={BEFORE}>{beforeName}</LegendKey>}
          <LegendKey color={BRAND} dotted>Booked ahead</LegendKey>
        </span>
      </figcaption>
      <div
        role="group" aria-labelledby={titleId} aria-describedby={helpId} tabIndex={0}
        onKeyDown={move} onBlur={() => setActive(null)}
        className="mt-5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5551FF]"
      >
        <div
          className="relative h-28 xl:h-20"
          onPointerMove={(event) => { if (event.pointerType === 'mouse') setActive(dayAt(event)); }}
          onPointerLeave={(event) => { if (event.pointerType === 'mouse') setActive(null); }}
          onClick={(event) => setActive(dayAt(event))}
        >
          {/* The scale: nothing, half and the top, each a hairline with its amount in francs. */}
          {[0, top / 2, top].map((tick) => (
            <React.Fragment key={tick}>
              <span aria-hidden="true" className={`absolute inset-x-0 border-t ${tick === 0 ? 'border-slate-200' : 'border-slate-100'}`} style={{ bottom: `${y(tick)}%` }} />
              {tick > 0 && <Tick label={amount(tick)} className="left-0 -translate-y-1" style={{ bottom: `${y(tick)}%` }} />}
            </React.Fragment>
          ))}
          <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={`${path(soFar)} L${x(now.at).toFixed(2)} 100 L0 100 Z`} fill={BRAND} fillOpacity="0.08" stroke="none" />
            {before && <path d={path([{ at: 0, value: 0 }, ...ends(before.days)])} stroke={BEFORE} vectorEffect="non-scaling-stroke" />}
            {/* Quieter than the solid line, and still dark enough to be seen as a line: 3.7:1 against the card. */}
            <path d={path(ahead)} stroke={BRAND} strokeOpacity="0.8" strokeDasharray="0.1 5" vectorEffect="non-scaling-stroke" />
            <path d={path(soFar)} stroke={BRAND} vectorEffect="non-scaling-stroke" />
          </svg>
          {/* Where the month before stood at the same point, and where this one stands now. */}
          {before && <span aria-hidden="true" className="absolute h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full ring-2 ring-white" style={{ left: `${x(before.then.at)}%`, bottom: `${y(before.then.value)}%`, backgroundColor: BEFORE }} />}
          <span aria-hidden="true" className="absolute h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full ring-2 ring-white" style={{ left: `${x(now.at)}%`, bottom: `${y(now.value)}%`, backgroundColor: BRAND }} />
          {shown && (
            <>
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 border-l border-slate-300" style={{ left: `${x(shown.at)}%` }} />
              {/* The day's figures stand over the legend, across the chart's width: they cover no line and never leave the card. */}
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] leading-snug shadow-md">
                <p className="font-bold text-slate-900">{shown.day === today ? 'Today, so far' : formatDate(dateOf(shown.day))}</p>
                <p className="flex items-baseline gap-1.5 text-slate-600">
                  <span className="inline-block h-0.5 w-3 shrink-0 -translate-y-1 rounded-full" style={{ backgroundColor: BRAND }} />
                  <span className="whitespace-nowrap font-semibold tabular-nums text-slate-900">{formatMoney(shown.value)}</span>
                  <span>{name}{shown.day > today ? ', with what is booked ahead' : ''}</span>
                </p>
                {shown.before !== null && (
                  <p className="flex items-baseline gap-1.5 text-slate-600">
                    <span className="inline-block h-0.5 w-3 shrink-0 -translate-y-1 rounded-full" style={{ backgroundColor: BEFORE }} />
                    <span className="whitespace-nowrap font-semibold tabular-nums text-slate-900">{formatMoney(shown.before)}</span>
                    <span>{beforeName}, by the same day</span>
                  </p>
                )}
              </div>
            </>
          )}
        </div>
        {/* The days of the month under the line: each stands where its day ends, as the line's points do. */}
        <div className="relative h-4">
          {[1, 10, 20, lastDay].map((day) => (
            <Tick key={day} label={`${day}.`} className={`top-1.5 ${day === lastDay ? '-translate-x-full' : '-translate-x-1/2'}`} style={{ left: `${x(day)}%` }} />
          ))}
        </div>
      </div>
      <p id={helpId} className="sr-only">
        A line chart: what the appointments of {formatMonth(month.from)} are worth at list prices, added up day by day{before ? `, beside ${beforeName}` : ''}. Use the left and right arrow keys to read a day.
      </p>
      <p aria-live="polite" className="sr-only">{active === null ? '' : describe(active)}</p>
    </figure>
  );
};
