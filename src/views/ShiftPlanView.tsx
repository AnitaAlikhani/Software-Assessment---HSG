import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  ArrowLeft,
  X,
  Trash2,
  Calendar,
  Info,
  Clock,
  User,
} from 'lucide-react';
import { ShiftEntry } from '../types';

interface ShiftPlanViewProps {
  shiftOverview: ShiftEntry[];
  onUpdateShift: (employeeId: string, dayKey: string, start: string, end: string) => void;
}

export const ShiftPlanView: React.FC<ShiftPlanViewProps> = ({
  shiftOverview,
  onUpdateShift,
}) => {
  // Mode: overview table vs individual Nilufar Ismayilova schedule
  const [selectedEmployeeSchedule, setSelectedEmployeeSchedule] = useState<string | null>(null);
  const [showNewShiftModal, setShowNewShiftModal] = useState(false);

  // New shift / week plan modal state
  const [modalResource, setModalResource] = useState('Nilufar Ismayilova');
  const [mondayAvailable, setMondayAvailable] = useState(true);
  const [mondayStart, setMondayStart] = useState('09:00');
  const [mondayEnd, setMondayEnd] = useState('18:00');

  const daysList = [
    'Mon 05 Oct',
    'Tue 06 Oct',
    'Wed 07 Oct',
    'Thu 08 Oct',
    'Fri 09 Oct',
    'Sat 10 Oct',
    'Sun 11 Oct',
  ];

  const handleSaveModal = () => {
    if (mondayAvailable) {
      onUpdateShift('emp-1', 'Mon 05 Oct', mondayStart, mondayEnd);
    }
    setShowNewShiftModal(false);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* If showing Nilufar Ismayilova individual schedule (Pages 12, 26) */}
      {selectedEmployeeSchedule ? (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Header with back button */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedEmployeeSchedule(null)}
                className="p-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 transition-colors"
                aria-label="Back to Shift Plan overview"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-2.5">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-200" />
                <div>
                  <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                    Nilufar Ismayilova
                  </h1>
                  <p className="text-xs text-slate-400 font-medium">Person · Active resource</p>
                </div>
              </div>
            </div>

            {/* Right controls & Metrics */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-4 px-3 py-1.5 bg-slate-100/80 rounded-xl text-xs font-semibold text-slate-600">
                <span><strong className="text-slate-900">32h</strong> scheduled</span>
                <span><strong className="text-slate-900">4</strong> shifts</span>
                <span className="text-[#5551FF]"><strong className="text-[#5551FF]">8h</strong> available</span>
              </div>

              <div className="flex items-center gap-1.5">
                <button className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs">
                  Today
                </button>
                <div className="flex items-center bg-white border border-slate-200 rounded-xl shadow-2xs">
                  <button className="p-1.5 text-slate-500 hover:text-slate-800 transition-colors">
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs font-medium text-slate-600 px-2 tabular-nums">28/09–04/10</span>
                  <button className="p-1.5 text-slate-500 hover:text-slate-800 transition-colors">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <button
                onClick={() => setShowNewShiftModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-2xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Shift</span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs font-bold text-slate-400 uppercase tracking-wider">
            <span>CALENDAR WEEK 40 · Mon 28 Sep — Sun 04 Oct</span>
          </div>

          {/* Nilufar Schedule Card Grid matching Figma Page 12 */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-x-auto p-4 sm:p-6">
            <div className="min-w-[780px]">
              {/* Day headers */}
              <div className="grid grid-cols-8 pb-4 border-b border-slate-100 text-center">
                <div className="text-xs font-semibold text-slate-400">GMT+2</div>
                <div className="text-xs font-semibold text-slate-700">
                  <p className="text-[11px] text-slate-400">MON</p>
                  <p className="text-base font-bold text-slate-900">28</p>
                </div>
                <div className="text-xs font-semibold text-slate-700">
                  <p className="text-[11px] text-slate-400">TUE</p>
                  <p className="text-base font-bold text-slate-900">29</p>
                </div>
                <div className="text-xs font-semibold text-slate-700">
                  <p className="text-[11px] text-slate-400">WED</p>
                  <p className="text-base font-bold text-white bg-[#5551FF] w-7 h-7 mx-auto rounded-full flex items-center justify-center">30</p>
                </div>
                <div className="text-xs font-semibold text-slate-700">
                  <p className="text-[11px] text-slate-400">THU</p>
                  <p className="text-base font-bold text-slate-900">01</p>
                </div>
                <div className="text-xs font-semibold text-slate-700">
                  <p className="text-[11px] text-slate-400">FRI</p>
                  <p className="text-base font-bold text-slate-900">02</p>
                </div>
                <div className="text-xs font-semibold text-slate-400">
                  <p className="text-[11px] text-slate-400">SAT</p>
                  <p className="text-base font-bold text-slate-400">03</p>
                </div>
                <div className="text-xs font-semibold text-slate-400">
                  <p className="text-[11px] text-slate-400">SUN</p>
                  <p className="text-base font-bold text-slate-400">04</p>
                </div>
              </div>

              {/* Time Rows */}
              <div className="relative divide-y divide-slate-100 text-xs">
                {/* 08:00 */}
                <div className="grid grid-cols-8 min-h-[56px] py-1">
                  <div className="text-right pr-3 text-slate-400 select-none">08:00</div>
                  <div className="border-r border-slate-100" />
                  <div className="border-r border-slate-100" />
                  {/* Wed 30: 08:00-12:00 Opening shift */}
                  <div className="border-r border-slate-100 px-1 row-span-2">
                    <div className="bg-sky-50 border border-sky-200 rounded-xl p-2 text-sky-950 shadow-2xs">
                      <span className="font-bold text-[11px] block">08:00–12:00</span>
                      <span className="font-semibold text-xs block">Opening shift</span>
                      <span className="text-[10px] text-sky-700">Front desk · 4h</span>
                    </div>
                  </div>
                  <div className="border-r border-slate-100" />
                  <div className="border-r border-slate-100" />
                  <div className="border-r border-slate-100 bg-slate-50/50 flex items-center justify-center text-slate-300 text-[11px]">
                    Not scheduled
                  </div>
                  <div className="bg-slate-50/50 flex items-center justify-center text-slate-300 text-[11px]">
                    Not scheduled
                  </div>
                </div>

                {/* 10:00 */}
                <div className="grid grid-cols-8 min-h-[56px] py-1">
                  <div className="text-right pr-3 text-slate-400 select-none">10:00</div>
                  {/* Mon 28: 09:00-13:00 Morning shift */}
                  <div className="border-r border-slate-100 px-1">
                    <div className="bg-sky-50 border border-sky-200 rounded-xl p-2 text-sky-950 shadow-2xs">
                      <span className="font-bold text-[11px] block">09:00–13:00</span>
                      <span className="font-semibold text-xs block">Morning shift</span>
                      <span className="text-[10px] text-sky-700">Front desk · 4h</span>
                    </div>
                  </div>
                  {/* Tue 29: 10:00-16:00 Full service shift */}
                  <div className="border-r border-slate-100 px-1">
                    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-2 text-indigo-950 shadow-2xs">
                      <span className="font-bold text-[11px] block">10:00–16:00</span>
                      <span className="font-semibold text-xs block">Full service shift</span>
                      <span className="text-[10px] text-indigo-700">Appointments · 6h</span>
                    </div>
                  </div>
                  <div className="border-r border-slate-100" />
                  <div className="border-r border-slate-100" />
                  {/* Fri 02: 09:00-15:00 Full service shift */}
                  <div className="border-r border-slate-100 px-1">
                    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-2 text-indigo-950 shadow-2xs">
                      <span className="font-bold text-[11px] block">09:00–15:00</span>
                      <span className="font-semibold text-xs block">Full service shift</span>
                      <span className="text-[10px] text-indigo-700">Appointments · 6h</span>
                    </div>
                  </div>
                  <div className="border-r border-slate-100 bg-slate-50/50" />
                  <div className="bg-slate-50/50" />
                </div>

                {/* 12:00 */}
                <div className="grid grid-cols-8 min-h-[56px] py-1">
                  <div className="text-right pr-3 text-slate-400 select-none">12:00</div>
                  <div className="border-r border-slate-100" />
                  <div className="border-r border-slate-100" />
                  <div className="border-r border-slate-100 px-1">
                    {/* Wed: 13:00-15:00 Admin time */}
                    <div className="bg-slate-100 border border-slate-200 rounded-xl p-2 text-slate-800 shadow-2xs">
                      <span className="font-bold text-[11px] block">13:00–15:00</span>
                      <span className="font-semibold text-xs block">Admin time</span>
                      <span className="text-[10px] text-slate-500">Planning · 2h</span>
                    </div>
                  </div>
                  {/* Thu 01: 12:00-16:00 Afternoon shift */}
                  <div className="border-r border-slate-100 px-1">
                    <div className="bg-purple-50 border border-purple-200 rounded-xl p-2 text-purple-950 shadow-2xs">
                      <span className="font-bold text-[11px] block">12:00–16:00</span>
                      <span className="font-semibold text-xs block">Afternoon shift</span>
                      <span className="text-[10px] text-purple-700">Appointments · 4h</span>
                    </div>
                  </div>
                  <div className="border-r border-slate-100" />
                  <div className="border-r border-slate-100 bg-slate-50/50" />
                  <div className="bg-slate-50/50" />
                </div>

                {/* 14:00 */}
                <div className="grid grid-cols-8 min-h-[56px] py-1">
                  <div className="text-right pr-3 text-slate-400 select-none">14:00</div>
                  <div className="border-r border-slate-100" />
                  <div className="border-r border-slate-100" />
                  <div className="border-r border-slate-100" />
                  <div className="border-r border-slate-100" />
                  <div className="border-r border-slate-100" />
                  <div className="border-r border-slate-100 bg-slate-50/50" />
                  <div className="bg-slate-50/50" />
                </div>

                {/* 16:00 */}
                <div className="grid grid-cols-8 min-h-[56px] py-1">
                  <div className="text-right pr-3 text-slate-400 select-none">16:00</div>
                  <div className="border-r border-slate-100" />
                  <div className="border-r border-slate-100" />
                  <div className="border-r border-slate-100" />
                  <div className="border-r border-slate-100" />
                  <div className="border-r border-slate-100" />
                  <div className="border-r border-slate-100 bg-slate-50/50" />
                  <div className="bg-slate-50/50" />
                </div>
              </div>

              {/* Footer legend matching Figma Page 12 */}
              <div className="flex items-center justify-between pt-4 mt-2 border-t border-slate-100 text-xs text-slate-500">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-md bg-sky-100 border border-sky-300" />
                    <span>Shift</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-md bg-slate-100 border border-slate-300" />
                    <span>Service / admin</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-emerald-600 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>8 hours available this week</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Overview Table Screen (Pages 5, 9) */
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                Shift Plan
              </h1>
              <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
                Week 41
              </span>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              <button className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs">
                Today
              </button>
              <div className="flex items-center bg-white border border-slate-200 rounded-xl shadow-2xs">
                <button className="p-1.5 text-slate-500 hover:text-slate-800 transition-colors">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs font-medium text-slate-600 px-2">Date range</span>
                <button className="p-1.5 text-slate-500 hover:text-slate-800 transition-colors">
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                onClick={() => setShowNewShiftModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Shift</span>
              </button>
            </div>
          </div>

          {/* Alert Notice Banner from Figma Page 5 */}
          <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-100/90 text-xs sm:text-sm text-indigo-900/80 leading-relaxed flex items-start gap-3">
            <Info className="w-4 h-4 text-[#5551FF] shrink-0 mt-0.5" />
            <p>
              To use the shift plan, activate it in your Booking Settings. Your employees' availability will then follow their shifts instead of the general booking hours.
            </p>
          </div>

          {/* Resources Shift Table */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-x-auto">
            <div className="min-w-[840px]">
              {/* Header row */}
              <div className="grid grid-cols-8 border-b border-slate-100 text-xs font-semibold text-slate-400 py-3.5 px-4 bg-slate-50/50">
                <div>Resources</div>
                {daysList.map((day) => (
                  <div key={day} className="text-center">
                    {day}
                  </div>
                ))}
              </div>

              {/* Rows */}
              <div className="divide-y divide-slate-100">
                {shiftOverview.map((item) => (
                  <div
                    key={item.employeeId}
                    className="grid grid-cols-8 items-center py-4 px-4 hover:bg-slate-50/60 transition-colors"
                  >
                    {/* Employee Profile Name */}
                    <div
                      onClick={() => setSelectedEmployeeSchedule(item.employeeName)}
                      className="flex items-center gap-3 cursor-pointer group"
                    >
                      <div
                        className={`w-8 h-8 rounded-xl ${item.avatarColor} flex items-center justify-center font-bold text-xs shrink-0 group-hover:scale-105 transition-transform`}
                      >
                        {item.initials}
                      </div>
                      <span className="text-xs font-semibold text-slate-800 group-hover:text-[#5551FF] transition-colors truncate">
                        {item.employeeName}
                      </span>
                    </div>

                    {/* Day shifts */}
                    {daysList.map((day) => {
                      const shift = item.shifts[day];
                      return (
                        <div key={day} className="flex justify-center px-1">
                          {shift ? (
                            <button
                              onClick={() => setSelectedEmployeeSchedule(item.employeeName)}
                              className={`text-[11px] font-semibold py-1.5 px-2.5 rounded-lg tabular-nums transition-transform hover:scale-105 shadow-2xs ${
                                item.employeeId === 'emp-1'
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200/70 hover:bg-emerald-100'
                                  : 'bg-purple-50 text-purple-800 border border-purple-200/70 hover:bg-purple-100'
                              }`}
                            >
                              {shift.start} – {shift.end}
                            </button>
                          ) : (
                            <div className="w-12 h-6 rounded-lg bg-slate-100/40" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Slide-over Modal: Week Plan - Week 41 (Pages 6, 10) */}
      {showNewShiftModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-lg bg-white h-full shadow-2xl p-6 overflow-y-auto space-y-6 flex flex-col animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-900">
                Week Plan - Week 41 (05/10 - 11/10)
              </h2>
              <button
                onClick={() => setShowNewShiftModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Selected resources */}
            <div className="space-y-1.5 text-xs">
              <label className="font-semibold text-slate-700 block">Selected resources</label>
              <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#5551FF]/10 text-[#5551FF] font-semibold">
                  {modalResource}
                  <X
                    className="w-3 h-3 cursor-pointer"
                    onClick={() => setModalResource('Eloise Denniese')}
                  />
                </span>
                <select
                  value={modalResource}
                  onChange={(e) => setModalResource(e.target.value)}
                  className="text-xs bg-transparent text-slate-500 focus:outline-hidden"
                >
                  <option value="Nilufar Ismayilova">Nilufar Ismayilova</option>
                  <option value="Eloise Denniese">Eloise Denniese</option>
                </select>
              </div>
            </div>

            {/* Selected template */}
            <div className="space-y-1.5 text-xs">
              <label className="font-semibold text-slate-700 block">Selected template</label>
              <select className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 focus:outline-hidden">
                <option>Choose a template</option>
                <option>Standard 40h Full-time (09:00 - 18:00)</option>
                <option>Weekend Shift (10:00 - 18:00)</option>
                <option>Part-time Morning</option>
              </select>
            </div>

            {/* Daily Availability switches */}
            <div className="space-y-4 pt-2 flex-1">
              {/* Monday */}
              <div className="space-y-2 pb-3 border-b border-slate-100">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800">Monday</span>
                </div>

                <div className="flex items-center gap-3">
                  {/* Switch */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mondayAvailable}
                      onChange={(e) => setMondayAvailable(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#5551FF]" />
                    <span className="text-xs font-semibold text-slate-700">Available</span>
                  </label>

                  {/* Times */}
                  {mondayAvailable && (
                    <div className="flex items-center gap-2 ml-auto">
                      <select
                        value={mondayStart}
                        onChange={(e) => setMondayStart(e.target.value)}
                        className="p-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg"
                      >
                        <option>08:00</option>
                        <option>09:00</option>
                        <option>10:00</option>
                      </select>
                      <span className="text-slate-400 text-xs">to</span>
                      <select
                        value={mondayEnd}
                        onChange={(e) => setMondayEnd(e.target.value)}
                        className="p-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg"
                      >
                        <option>16:00</option>
                        <option>17:00</option>
                        <option>18:00</option>
                        <option>19:00</option>
                      </select>
                      <button
                        onClick={() => setMondayAvailable(false)}
                        className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <button className="flex items-center gap-1.5 text-xs text-[#5551FF] font-semibold mt-1">
                  <Plus className="w-3 h-3" />
                  <span>Add availability</span>
                </button>
              </div>

              {/* Tuesday to Sunday rows matching Figma */}
              {['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(
                (dayName) => (
                  <div key={dayName} className="space-y-1.5 pb-2.5 border-b border-slate-100">
                    <span className="font-bold text-xs text-slate-800 block">{dayName}</span>
                    <button className="flex items-center gap-1.5 text-xs text-[#5551FF] font-semibold">
                      <Plus className="w-3 h-3" />
                      <span>Add availability</span>
                    </button>
                  </div>
                )
              )}
            </div>

            {/* Bottom Save */}
            <div className="pt-4 border-t border-slate-100">
              <button
                onClick={handleSaveModal}
                className="w-full py-2.5 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
