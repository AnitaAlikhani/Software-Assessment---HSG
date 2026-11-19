import React, { useState } from 'react';
import { Download } from 'lucide-react';
import {
  analyticsPeriods, appointmentAnalytics, appointmentBuckets, axisTicks, conversationAnalytics, periodLabel,
  type AppointmentBucket, type Period,
} from '../analytics';
import { formatCalendarDate, getSalonNow } from '../scheduling';
import { formatMonthShort } from '../format';
import type { CalendarEvent, Conversation } from '../types';

interface AnalyticsProps {
  events: CalendarEvent[];
  /** Every chat the owner sees, live ones included, so the counts match the header and Home. */
  conversations: Conversation[];
  companyName: string;
  timeZone: string;
  /** The current moment. Left out, the view reads the clock itself. */
  now?: Date;
  /** Starts the download of the report for a period. "Export CSV" is shown only when this is given. */
  onExportReport?: (period: Period) => void;
}

const Metric = ({ label, value, note }: { label: string; value: number; note?: string }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
    <h3 className="text-sm font-semibold text-slate-600">{label}</h3>
    <p className="mt-3 text-3xl font-bold text-slate-900">{value}</p>
    {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
  </div>
);

const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`;

type BucketUnit = 'day' | 'week' | 'month';
/** Up to this many bars every one is labelled, and the labels have room to sit under the middle of their bar. */
const SHORT_PERIOD = 8;

/** A bar in words: the day as the Calendar writes it, or the days of the week or month it stands for. */
const bucketName = (bucket: AppointmentBucket, unit: BucketUnit) =>
  unit === 'day' ? formatCalendarDate(bucket.from) : periodLabel(bucket);

/**
 * What stands under a bar, or null where a label would crowd its neighbours: every day of a
 * short period, the Mondays of a longer one, and every few weeks or months beyond that.
 */
const axisLabel = (bucket: AppointmentBucket, index: number, count: number, unit: BucketUnit): React.ReactNode => {
  const [weekday, ...rest] = formatCalendarDate(bucket.from).split(' ');
  const day = rest.join(' ') || weekday;
  if (unit === 'day') {
    if (count <= SHORT_PERIOD) return <><span className="block">{weekday}</span><span className="block">{rest.join(' ')}</span></>;
    // On a phone a month of bars leaves room for the date only.
    return new Date(`${bucket.from}T00:00:00Z`).getUTCDay() === 1 ? <>{rest.length > 0 && <span className="hidden sm:inline">{weekday} </span>}{day}</> : null;
  }
  if (index % Math.ceil(count / 6) !== 0) return null;
  return unit === 'week' ? day : formatMonthShort(bucket.from);
};

/**
 * Appointments per day, week or month as bars. The bars are plain boxes sized in per cent, so
 * the chart fits a phone without scrolling sideways and its text keeps its size.
 * Pointing at a bar, tapping it or moving to it with the arrow keys shows its numbers; the
 * table under the chart lists the same numbers for everyone who cannot use the bars.
 */
const AppointmentChart = ({ buckets, unit, period }: { buckets: AppointmentBucket[]; unit: BucketUnit; period: Period }) => {
  const [active, setActive] = useState<number | null>(null);
  const ticks = axisTicks(Math.max(...buckets.map(bucket => bucket.count)));
  const top = ticks[ticks.length - 1];
  const height = (count: number) => `${count / top * 100}%`;
  const describe = (bucket: AppointmentBucket) => bucket.count === 0
    ? `${bucketName(bucket, unit)}: no appointments`
    : `${bucketName(bucket, unit)}: ${plural(bucket.count, 'appointment')}, ${bucket.aiBookings} booked by AI`;
  const move = (event: React.KeyboardEvent) => {
    const last = buckets.length - 1;
    const next = event.key === 'ArrowRight' ? Math.min(last, (active ?? -1) + 1)
      : event.key === 'ArrowLeft' ? Math.max(0, (active ?? buckets.length) - 1)
      : event.key === 'Home' ? 0 : event.key === 'End' ? last : event.key === 'Escape' ? null : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  };

  return (
    <div className="mt-4">
      <div
        role="group"
        aria-label="Appointment chart"
        aria-describedby="analytics-chart-help"
        tabIndex={0}
        onKeyDown={move}
        onBlur={() => setActive(null)}
        // The top of the scale stands half above the chart: the padding keeps it inside the focus ring.
        className="flex rounded-lg pt-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5551FF]"
      >
        {/* Scale */}
        <div aria-hidden="true" className="relative h-44 w-8 shrink-0 text-[11px] tabular-nums text-slate-500">
          {ticks.map(tick => <span key={tick} className="absolute right-2 translate-y-1/2 leading-none" style={{ bottom: height(tick) }}>{tick}</span>)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-44" onPointerLeave={event => { if (event.pointerType === 'mouse') setActive(null); }}>
            {ticks.map(tick => <div key={tick} aria-hidden="true" className={`absolute inset-x-0 border-t ${tick === 0 ? 'border-slate-300' : 'border-slate-200'}`} style={{ bottom: height(tick) }} />)}
            <div className="absolute inset-0 flex items-end">
              {buckets.map((bucket, index) => (
                <div
                  key={bucket.from}
                  // The whole column answers, not only the bar: a short bar on a phone is a few pixels wide.
                  onPointerEnter={event => { if (event.pointerType === 'mouse') setActive(index); }}
                  onClick={() => setActive(index)}
                  className={`relative flex h-full min-w-0 flex-1 items-end justify-center px-px ${active === index ? 'bg-slate-100' : ''}`}
                >
                  {bucket.count > 0 && <div aria-hidden="true" className={`min-h-0.5 w-full max-w-6 rounded-t-[4px] ${active === index ? 'bg-[#433fd8]' : 'bg-[#5551FF]'}`} style={{ height: height(bucket.count) }} />}
                  {active === index && (
                    <div
                      aria-hidden="true"
                      className={`pointer-events-none absolute z-10 mb-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] leading-snug shadow-md ${
                        index < buckets.length / 3 ? 'left-0' : index >= buckets.length * 2 / 3 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                      }`}
                      style={{ bottom: height(bucket.count) }}
                    >
                      <p className="font-bold text-slate-900">{bucket.count === 0 ? 'No appointments' : plural(bucket.count, 'appointment')}</p>
                      <p className="text-slate-500">{bucketName(bucket, unit)}{bucket.count > 0 && ` · ${bucket.aiBookings} booked by AI`}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          {/* Labels under the bars */}
          <div aria-hidden="true" className="flex h-9 text-[11px] leading-tight text-slate-500">
            {buckets.map((bucket, index) => {
              const label = axisLabel(bucket, index, buckets.length, unit);
              return (
                <div key={bucket.from} className="relative min-w-0 flex-1">
                  {label && (
                    // Under a narrow bar at either end the label is kept inside the chart.
                    <span className={`absolute top-1.5 whitespace-nowrap text-center ${
                      buckets.length <= SHORT_PERIOD ? 'left-1/2 -translate-x-1/2'
                        : index === 0 ? 'left-0' : index === buckets.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                    }`}>
                      {label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p id="analytics-chart-help" className="sr-only">
        Bars show the appointments per {unit} for {periodLabel(period)}. Use the left and right arrow keys to read a bar. The table below lists the same numbers.
      </p>
      <p aria-live="polite" className="sr-only">{active === null ? '' : describe(buckets[active])}</p>
    </div>
  );
};

export const AnalyticsView: React.FC<AnalyticsProps> = ({ events, conversations, companyName, timeZone, now, onExportReport }) => {
  const [activeTab, setActiveTab] = useState<'Appointments' | 'Messages' | 'Languages'>('Appointments');
  const clock = getSalonNow(timeZone, now);
  // The periods Home counts for too. The page opens on the current month, including the days
  // still to come: a booking made a minute ago for next week is part of what the owner wants to see.
  const periods = analyticsPeriods(clock.date);
  const presets = [
    { label: 'Today', period: periods.today },
    { label: 'This week', period: periods.week },
    { label: 'This month', period: periods.month },
  ];
  const [from, setFrom] = useState(periods.month.from);
  const [to, setTo] = useState(periods.month.to);
  const appointments = appointmentAnalytics(events, from, to, clock);
  const messages = conversationAnalytics(conversations);
  const { unit, buckets } = appointmentBuckets(appointments.series);
  const stillToCome = appointments.stillToCome ?? 0;
  const progress = stillToCome === 0 ? ''
    : stillToCome === appointments.total ? ' · all still to come'
    : ` · ${appointments.total - stillToCome} so far, ${stillToCome} still to come`;
  const unitName = { day: 'Day', week: 'Week', month: 'Month' }[unit];

  return (
    <div className="min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="w-fit text-2xl font-bold text-slate-900">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500 [overflow-wrap:anywhere]">{companyName} · counted from your calendar and conversations</p>
      </div>
      <div role="tablist" aria-label="Analytics category" className="flex gap-5 border-b border-slate-200 text-sm font-semibold">
        {(['Appointments', 'Messages', 'Languages'] as const).map(tab => (
          <button key={tab} role="tab" id={`analytics-tab-${tab}`} tabIndex={activeTab === tab ? 0 : -1} aria-selected={activeTab === tab} aria-controls="analytics-panel" onClick={() => setActiveTab(tab)} onKeyDown={event => {
            const tabs = ['Appointments', 'Messages', 'Languages'] as const;
            const index = tabs.indexOf(tab);
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault();
            setActiveTab(tabs[next]);
            document.getElementById(`analytics-tab-${tabs[next]}`)?.focus();
          }} className={`min-h-11 pb-3 pt-2 ${activeTab === tab ? 'border-b-2 border-[#5551FF] text-[#5551FF]' : 'text-slate-500 hover:text-slate-900'}`}>{tab}</button>
        ))}
      </div>
      <section role="tabpanel" id="analytics-panel" aria-labelledby={`analytics-tab-${activeTab}`} className="space-y-6">
        {activeTab === 'Appointments' ? <>
          {/* One row of filters above everything they apply to: the usual periods first, then any other dates. */}
          <div className="flex flex-wrap items-end gap-3">
            <div role="group" aria-label="Period" className="flex flex-wrap gap-2">
              {presets.map(({ label, period }) => {
                const chosen = from === period.from && to === period.to;
                return (
                  <button key={label} type="button" aria-pressed={chosen} onClick={() => { setFrom(period.from); setTo(period.to); }}
                    className={`min-h-11 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-semibold ${chosen ? 'border-[#5551FF] bg-indigo-50 text-[#5551FF]' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto">
              <label className="min-w-0 text-xs font-semibold text-slate-600">From<input aria-label="From date" type="date" value={from} onChange={event => setFrom(event.target.value)} className="mt-1 block min-h-11 w-full max-w-full rounded-lg border border-slate-200 bg-white p-2 text-base sm:w-auto sm:text-sm" /></label>
              <label className="min-w-0 text-xs font-semibold text-slate-600">To<input aria-label="To date" type="date" value={to} onChange={event => setTo(event.target.value)} className="mt-1 block min-h-11 w-full max-w-full rounded-lg border border-slate-200 bg-white p-2 text-base sm:w-auto sm:text-sm" /></label>
            </div>
            {onExportReport && (
              <button type="button" disabled={Boolean(appointments.error)} onClick={() => onExportReport({ from, to })}
                className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 sm:ml-auto">
                <Download className="h-4 w-4 text-slate-500" />
                <span>Export CSV</span>
              </button>
            )}
          </div>
          {appointments.error ? <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{appointments.error}</p> : <>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 shadow-xs">
              <h2><span className="block text-4xl font-bold text-slate-900">{appointments.total}</span> <span className="text-sm font-semibold text-slate-600">{appointments.total === 1 ? 'appointment' : 'appointments'}</span></h2>
              <p className="mt-1 text-xs text-slate-500">{periodLabel({ from, to })}{progress}</p>
              {appointments.total === 0
                ? <p className="mt-6 text-sm text-slate-500">No appointments in this period.</p>
                // One day is one number: a chart with a single bar would add nothing.
                : buckets.length > 1 && <>
                  <AppointmentChart key={`${from}:${to}`} buckets={buckets} unit={unit} period={{ from, to }} />
                  <details className="mt-2 text-xs text-slate-600">
                    <summary className="min-h-11 cursor-pointer py-3 font-semibold">Appointments per {unit}</summary>
                    <table className="w-full max-w-md text-left tabular-nums">
                      <thead>
                        <tr className="text-slate-500">
                          <th scope="col" className="py-1.5 pr-4 font-semibold">{unitName}</th>
                          <th scope="col" className="py-1.5 pr-4 text-right font-semibold">Appointments</th>
                          <th scope="col" className="py-1.5 text-right font-semibold">Booked by AI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Closed days and empty weeks are left out: a row of zeros tells the owner nothing. */}
                        {buckets.filter(bucket => bucket.count > 0).map(bucket => (
                          <tr key={bucket.from} className="border-t border-slate-100">
                            <th scope="row" className="py-1.5 pr-4 font-normal">{bucketName(bucket, unit)}</th>
                            <td className="py-1.5 pr-4 text-right">{bucket.count}</td>
                            <td className="py-1.5 text-right">{bucket.aiBookings}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </>}
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Metric label="Customers with appointments" value={appointments.customers} />
              <Metric label="Booked by AI" value={appointments.aiBookings} note={appointments.aiShare === null ? undefined : `${appointments.aiShare}% of appointments`} />
              <Metric label="Other bookings" value={appointments.otherBookings} />
            </div>
          </>}
        </> : activeTab === 'Messages' ? <>
          <h2 className="text-lg font-bold">{plural(messages.total, 'message')}</h2>
          <p className="text-sm text-slate-500">
            All messages in your {plural(messages.conversations, 'conversation')}.
            {messages.waiting > 0 && ` ${messages.waiting === 1 ? '1 conversation is' : `${messages.waiting} conversations are`} waiting for you.`}
          </p>
          <div className="grid gap-4 md:grid-cols-3"><Metric label="Customer messages" value={messages.customer} /><Metric label="AI replies" value={messages.ai} /><Metric label="Owner replies" value={messages.owner} /></div>
        </> : <>
          <h2 className="text-lg font-bold">Conversation languages</h2>
          <p className="text-sm text-slate-500">Customer languages across your {plural(messages.conversations, 'conversation')}.</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{messages.languages.map(item => <Metric key={item.name} label={item.name} value={item.count} />)}</div>
        </>}
      </section>
    </div>
  );
};
