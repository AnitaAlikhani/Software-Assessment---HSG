import React, { useState } from 'react';
import { Info, Calendar, Building2 } from 'lucide-react';

export const AnalyticsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'Appointments' | 'Messages' | 'Languages'>('Appointments');
  const [branch, setBranch] = useState('Bella Hair Salon');
  const [dateRange, setDateRange] = useState('05.09.2026 - 05.10.2026');

  // Dates for the x-axis matching Figma
  const dates = [
    '05 Sep',
    '08 Sep',
    '11 Sep',
    '14 Sep',
    '17 Sep',
    '20 Sep',
    '23 Sep',
    '26 Sep',
    '29 Sep',
    '02 Oct',
    '05 Oct',
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Header Controls matching Figma Page 13, 27 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          Analytics
        </h1>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="px-3.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 shadow-2xs focus:outline-hidden"
          >
            <option value="Bella Hair Salon">Bella Hair Salon</option>
          </select>

          <div className="flex items-center gap-2 px-3.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 shadow-2xs">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="tabular-nums">{dateRange}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-slate-200 text-xs font-bold">
        {(['Appointments', 'Messages', 'Languages'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-3 transition-colors ${
              activeTab === tab
                ? 'text-[#5551FF] border-b-2 border-[#5551FF]'
                : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Main Chart Card matching Figma Page 13 */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-7 shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base sm:text-lg font-bold text-slate-900">
            3 Appointments
          </h2>
          <Info className="w-3.5 h-3.5 text-slate-400" />
        </div>

        {/* SVG Line Graph */}
        <div className="relative pt-4 pb-2">
          <div className="h-52 w-full flex">
            {/* Y-axis labels */}
            <div className="flex flex-col justify-between text-[11px] text-slate-400 pr-3 pb-6 select-none tabular-nums text-right w-8">
              <span>1</span>
              <span>0.75</span>
              <span>0.5</span>
              <span>0.25</span>
              <span>0</span>
            </div>

            {/* Chart Area */}
            <div className="relative flex-1 pb-6">
              {/* Horizontal grid lines */}
              <div className="absolute inset-0 pb-6 flex flex-col justify-between pointer-events-none">
                <div className="border-b border-slate-100 w-full" />
                <div className="border-b border-slate-100 w-full" />
                <div className="border-b border-slate-100 w-full" />
                <div className="border-b border-slate-100 w-full" />
                <div className="border-b border-slate-200 w-full" />
              </div>

              {/* SVG Line Path matching the Figma curve (peaks near 29 Sep and 02 Oct) */}
              <svg
                viewBox="0 0 1000 200"
                preserveAspectRatio="none"
                className="w-full h-full overflow-visible"
              >
                <defs>
                  <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5551FF" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="#5551FF" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Area under curve */}
                <path
                  d="M 0,200 L 700,200 L 730,20 L 770,195 L 820,25 L 850,200 L 1000,200 Z"
                  fill="url(#chartGradient)"
                />

                {/* Line */}
                <path
                  d="M 0,200 L 700,200 L 730,20 L 770,195 L 820,25 L 850,200 L 1000,200"
                  fill="none"
                  stroke="#5551FF"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Data points */}
                <circle cx="730" cy="20" r="4" fill="#5551FF" stroke="#FFFFFF" strokeWidth="2" />
                <circle cx="820" cy="25" r="4" fill="#5551FF" stroke="#FFFFFF" strokeWidth="2" />
              </svg>
            </div>
          </div>

          {/* X-axis Date Labels */}
          <div className="flex justify-between pl-8 text-[11px] text-slate-400 select-none overflow-x-auto">
            {dates.map((d) => (
              <span key={d} className="whitespace-nowrap px-1">
                {d}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 3 Bottom Metric Cards matching Figma Page 13 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Number of Customers */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-center gap-1.5">
            <h3 className="text-xs font-bold text-slate-800">Number of Customers</h3>
            <Info className="w-3.5 h-3.5 text-slate-400" />
          </div>

          <div className="text-center py-2">
            <span className="text-[11px] text-slate-400 font-medium block">Total</span>
            <span className="text-3xl font-extrabold text-[#5551FF] tabular-nums">1</span>
          </div>

          <div className="space-y-2 text-xs pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px]">New</span>
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 bg-slate-100 rounded-full" />
                <span className="font-semibold text-slate-800 tabular-nums">0</span>
              </div>
            </div>

            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px] font-medium text-slate-700">New & Returning</span>
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 bg-amber-400 rounded-full" />
                <span className="font-semibold text-slate-800 tabular-nums">1</span>
              </div>
            </div>

            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px]">Returning</span>
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 bg-slate-100 rounded-full" />
                <span className="font-semibold text-slate-800 tabular-nums">0</span>
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: AI Assistant Metrics */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-center gap-1.5">
            <h3 className="text-xs font-bold text-slate-800">AI Assistant</h3>
            <Info className="w-3.5 h-3.5 text-slate-400" />
          </div>

          <div className="space-y-3.5 py-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Messages handled</span>
              <span className="font-bold text-slate-900 tabular-nums">24</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500">Bookings made by AI</span>
              <span className="font-bold text-slate-900 tabular-nums">3</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500">After-hours replies</span>
              <span className="font-bold text-slate-900 tabular-nums">9</span>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-slate-100">
              <span className="text-slate-500">Avg. reply time</span>
              <span className="font-bold text-[#5551FF] tabular-nums">12 sec</span>
            </div>
          </div>
        </div>

        {/* Card 3: Appointment Sources Donut Chart */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-center gap-1.5">
            <h3 className="text-xs font-bold text-slate-800">Appointment Sources</h3>
            <Info className="w-3.5 h-3.5 text-slate-400" />
          </div>

          {/* Donut Chart SVG */}
          <div className="flex items-center justify-center py-2">
            <div className="relative w-28 h-28 flex items-center justify-center">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                {/* Background Track */}
                <circle
                  cx="18"
                  cy="18"
                  r="14"
                  fill="transparent"
                  stroke="#F1F5F9"
                  strokeWidth="5"
                />
                {/* WhatsApp: 67% */}
                <circle
                  cx="18"
                  cy="18"
                  r="14"
                  fill="transparent"
                  stroke="#5551FF"
                  strokeWidth="5"
                  strokeDasharray="59 100"
                  strokeDashoffset="0"
                  strokeLinecap="round"
                />
                {/* Instagram: 33% */}
                <circle
                  cx="18"
                  cy="18"
                  r="14"
                  fill="transparent"
                  stroke="#FB923C"
                  strokeWidth="5"
                  strokeDasharray="29 100"
                  strokeDashoffset="-59"
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center flex-col">
                <span className="text-xs font-extrabold text-slate-800">100%</span>
              </div>
            </div>
          </div>

          {/* Legend matching Figma */}
          <div className="flex items-center justify-center gap-5 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#5551FF]" />
              <span className="font-medium text-slate-700">WhatsApp 67%</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#FB923C]" />
              <span className="font-medium text-slate-700">Instagram 33%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
