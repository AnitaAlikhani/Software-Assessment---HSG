import React, { useRef, useState } from 'react';
import { useHorizontalOverflow } from '../useHorizontalOverflow';
import { appointmentAnalytics, conversationAnalytics } from '../analytics';
import { addDays, getSalonNow } from '../scheduling';
import type { CalendarEvent, Conversation } from '../types';

interface AnalyticsProps {
  events: CalendarEvent[];
  conversations: Conversation[];
  companyName: string;
  timeZone: string;
}

const Metric = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
    <h3 className="text-sm font-semibold text-slate-600">{label}</h3>
    <p className="mt-3 text-3xl font-bold tabular-nums text-[#5551FF]">{value}</p>
  </div>
);

export const AnalyticsView: React.FC<AnalyticsProps> = ({ events, conversations, companyName, timeZone }) => {
  const [activeTab, setActiveTab] = useState<'Appointments' | 'Messages' | 'Languages'>('Appointments');
  const today = getSalonNow(timeZone).date;
  const [from, setFrom] = useState(() => addDays(today, -29));
  const [to, setTo] = useState(today);
  const appointments = appointmentAnalytics(events, from, to);
  const messages = conversationAnalytics(conversations);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartScrolls = useHorizontalOverflow(chartRef, [activeTab, Boolean(appointments.error)]);
  const max = Math.max(1, ...appointments.series.map(point => point.count));
  const pointX = (index: number) => appointments.series.length > 1 ? index * 1000 / (appointments.series.length - 1) : 500;
  const points = appointments.series.map((point, index) => `${pointX(index)},${180 - point.count / max * 160}`).join(' ');
  const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <div className="min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-slate-900">Analytics</h1>
          <p className="mt-1 text-xs text-slate-500">Based on appointments and conversations in this demo tab.</p></div>
        <p className="max-w-full break-words rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold">{companyName}</p>
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
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 text-xs font-semibold text-slate-600">From<input aria-label="From date" type="date" value={from} onChange={event => setFrom(event.target.value)} className="mt-1 block min-h-11 max-w-full rounded-lg border border-slate-200 bg-white p-2 text-base sm:text-sm" /></label>
            <label className="min-w-0 text-xs font-semibold text-slate-600">To<input aria-label="To date" type="date" value={to} onChange={event => setTo(event.target.value)} className="mt-1 block min-h-11 max-w-full rounded-lg border border-slate-200 bg-white p-2 text-base sm:text-sm" /></label>
            <button onClick={() => { setFrom(addDays(today, -29)); setTo(today); }} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold">Last 30 days</button>
          </div>
          {appointments.error ? <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{appointments.error}</p> : <>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 shadow-xs">
              <h2 className="text-lg font-bold">{appointments.total} {appointments.total === 1 ? 'Appointment' : 'Appointments'}</h2>
              <p className="mt-1 text-xs text-slate-500">{dateLabel(from)} – {dateLabel(to)} · Counts use the company’s local appointment dates.</p>
              {chartScrolls && <p id="analytics-scroll-hint" className="mt-3 text-xs text-slate-500">Swipe the chart horizontally to see every date.</p>}
              <div ref={chartRef} role="region" aria-label="Appointment chart" aria-describedby={chartScrolls ? 'analytics-scroll-hint' : undefined} tabIndex={chartScrolls ? 0 : undefined} className="mt-5 max-w-full overflow-x-auto pb-2 focus-visible:outline-2 focus-visible:outline-[#5551FF]">
                <div className="min-w-[640px] px-2">
                  <svg role="img" aria-label={`Daily appointments from ${from} to ${to}; maximum ${max} per day`} viewBox="-35 0 1070 210" className="h-56 w-full">
                    {[0, max].map(value => <g key={value}><line x1="0" x2="1000" y1={180 - value / max * 160} y2={180 - value / max * 160} stroke="#e2e8f0" /><text x="-12" y={184 - value / max * 160} textAnchor="end" fontSize="12" fill="#64748b">{value}</text></g>)}
                    <polyline points={points} fill="none" stroke="#5551FF" strokeWidth="3" />
                    {appointments.series.map((point, index) => point.count > 0 && <circle key={point.date} cx={pointX(index)} cy={180 - point.count / max * 160} r="4" fill="#5551FF"><title>{`${point.date}: ${point.count}`}</title></circle>)}
                    {appointments.series.filter((_, index, all) => index === 0 || index === all.length - 1 || (index % Math.max(1, Math.ceil(all.length / 8)) === 0 && index < all.length - Math.ceil(all.length / 16))).map(point => {
                      const index = appointments.series.findIndex(item => item.date === point.date);
                      return <text key={point.date} x={pointX(index)} y="205" textAnchor={index === 0 ? 'start' : index === appointments.series.length - 1 ? 'end' : 'middle'} fontSize="11" fill="#64748b">{dateLabel(point.date)}</text>;
                    })}
                  </svg>
                </div>
              </div>
              <details className="mt-3 text-xs text-slate-600"><summary className="min-h-11 cursor-pointer py-3 font-semibold">Daily totals</summary>
                <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{appointments.series.map(point => <li key={point.date}>{point.date}: {point.count}</li>)}</ul>
              </details>
            </div>
            <div className="grid gap-4 md:grid-cols-3"><Metric label="Customers with appointments" value={appointments.customers} /><Metric label="AI bookings" value={appointments.aiBookings} /><Metric label="Other bookings" value={appointments.total - appointments.aiBookings} /></div>
          </>}
        </> : activeTab === 'Messages' ? <>
          <h2 className="text-lg font-bold">{messages.total} messages</h2>
          <p className="text-sm text-slate-500">All conversations in this demo tab. Date filtering is available for appointments; these demo messages have no recorded calendar dates.</p>
          <div className="grid gap-4 md:grid-cols-3"><Metric label="Customer messages" value={messages.customer} /><Metric label="AI replies" value={messages.ai} /><Metric label="Owner replies" value={messages.owner} /></div>
        </> : <>
          <h2 className="text-lg font-bold">Conversation languages</h2>
          <p className="text-sm text-slate-500">Customer language across all {conversations.length} conversations in this demo tab.</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{messages.languages.map(item => <Metric key={item.language} label={{ EN: 'English', FR: 'French', DE: 'German', IT: 'Italian' }[item.language]} value={item.count} />)}</div>
        </>}
      </section>
    </div>
  );
};
