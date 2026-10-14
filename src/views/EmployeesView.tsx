import React, { useState } from 'react';
import {
  Plus,
  ArrowLeft,
  Trash2,
  Info,
  Building,
  Check,
} from 'lucide-react';
import { Employee } from '../types';

interface EmployeesViewProps {
  employees: Employee[];
  onAddEmployee: (emp: Omit<Employee, 'id' | 'initials' | 'name'>) => void;
  onDeleteEmployee: (id: string) => void;
}

export const EmployeesView: React.FC<EmployeesViewProps> = ({
  employees,
  onAddEmployee,
  onDeleteEmployee,
}) => {
  const [isAddingMode, setIsAddingMode] = useState(false);

  // Form State matching Figma Page 19, 33
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [mobilePhone, setMobilePhone] = useState('');
  const [hidden, setHidden] = useState(false);
  const [branch, setBranch] = useState('Bella Hair Salon');
  const [canBookOnline, setCanBookOnline] = useState(true);

  const handleSave = (addAnother = false) => {
    if (!firstName.trim() || !lastName.trim()) return;

    onAddEmployee({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim() || 'employee@bellahair.ch',
      phone: mobilePhone.trim() || '+41 79 000 00 00',
      status: 'Active',
      location: branch,
      canBookOnline,
      hidden,
    });

    if (addAnother) {
      setFirstName('');
      setLastName('');
      setEmail('');
      setMobilePhone('');
    } else {
      setIsAddingMode(false);
      setFirstName('');
      setLastName('');
      setEmail('');
      setMobilePhone('');
    }
  };

  return (
    <div className="min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {isAddingMode ? (
        /* Add Employee Screen matching Figma Page 19, 33 */
        <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsAddingMode(false)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 transition-colors"
              aria-label="Back to employees list"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Add an employee
            </h1>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-xs space-y-6">
            {/* Name Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label htmlFor="employee-first-name" className="text-xs font-semibold text-slate-700 block mb-1.5">
                  First name *
                </label>
                <input
                  id="employee-first-name"
                  type="text"
                  required
                  placeholder="e.g. Jessica"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border-b border-slate-300 focus:border-[#5551FF] focus:bg-white focus:outline-hidden text-base sm:text-sm transition-all rounded-t-lg"
                />
              </div>

              <div>
                <label htmlFor="employee-last-name" className="text-xs font-semibold text-slate-700 block mb-1.5">
                  Last name *
                </label>
                <input
                  id="employee-last-name"
                  type="text"
                  required
                  placeholder="e.g. Schmid"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border-b border-slate-300 focus:border-[#5551FF] focus:bg-white focus:outline-hidden text-base sm:text-sm transition-all rounded-t-lg"
                />
              </div>
            </div>

            {/* Contact Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label htmlFor="employee-email" className="text-xs font-semibold text-slate-700 block mb-1.5">
                  Email
                </label>
                <input
                  id="employee-email"
                  type="email"
                  placeholder="jessica.schmid@bellahair.ch"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border-b border-slate-300 focus:border-[#5551FF] focus:bg-white focus:outline-hidden text-base sm:text-sm transition-all rounded-t-lg"
                />
              </div>

              <div>
                <label htmlFor="employee-phone" className="text-xs font-semibold text-slate-700 block mb-1.5">
                  Mobile phone
                </label>
                <input
                  id="employee-phone"
                  type="tel"
                  placeholder="+41 78 555 12 34"
                  value={mobilePhone}
                  onChange={(e) => setMobilePhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border-b border-slate-300 focus:border-[#5551FF] focus:bg-white focus:outline-hidden text-base sm:text-sm transition-all rounded-t-lg"
                />
              </div>
            </div>

            {/* Hide Employee Switch */}
            <div className="pt-2">
              <label className="relative flex min-h-11 items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hidden}
                  onChange={(e) => setHidden(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="relative w-11 h-6 shrink-0 bg-slate-200 rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-[#5551FF] peer-focus-visible:ring-offset-2 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#5551FF]" />
                <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  Hide this employee
                  <Info className="w-3.5 h-3.5 text-slate-400" />
                </span>
              </label>
            </div>

            {/* Branches Section matching Figma */}
            <div className="pt-4 border-t border-slate-100 space-y-3">
              <label htmlFor="employee-branch" className="text-xs font-bold text-slate-700 block">Branches</label>
              <select
                id="employee-branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="min-w-0 min-h-11 w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-base sm:text-sm text-slate-700 focus:outline-hidden"
              >
                <option value="Bella Hair Salon">Bella Hair Salon</option>
              </select>
            </div>

            {/* Branch Sub-settings */}
            <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/60 space-y-3">
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                BELLA HAIR SALON
              </p>

              <label className="relative flex min-h-11 items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={canBookOnline}
                  onChange={(e) => setCanBookOnline(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="relative w-11 h-6 shrink-0 bg-slate-200 rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-[#5551FF] peer-focus-visible:ring-offset-2 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#5551FF]" />
                <span className="text-xs font-semibold text-slate-700">
                  Can be booked online by customers
                </span>
              </label>
            </div>

            {/* Buttons matching Figma */}
            <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row gap-3 justify-end">
              <button
                type="button"
                onClick={() => handleSave(true)}
                className="px-5 py-2.5 text-xs font-semibold text-[#5551FF] bg-[#5551FF]/10 hover:bg-[#5551FF]/18 rounded-xl transition-colors"
              >
                Save and add another employee
              </button>

              <button
                type="button"
                onClick={() => handleSave(false)}
                className="px-6 py-2.5 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors"
              >
                Save Employee
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Employees List Screen matching Figma Page 16, 30 */
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Employees
            </h1>

            <button
              onClick={() => setIsAddingMode(true)}
              className="flex min-h-11 items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Employee</span>
            </button>
          </div>

          {/* Sub-header / Branch tab */}
          <div className="border-b border-slate-200/80">
            <span className="inline-block pb-2 text-xs font-bold text-[#5551FF] border-b-2 border-[#5551FF]">
              Bella Hair Salon
            </span>
          </div>

          {/* Employees Table matching Figma */}
          <p id="employees-scroll-hint" className="text-xs text-slate-500 xl:hidden">Swipe horizontally to see contact details and actions. Names stay visible.</p>
          <div role="region" aria-label="Employees" aria-describedby="employees-scroll-hint" tabIndex={0} className="relative max-w-full bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-x-auto focus-visible:outline-2 focus-visible:outline-[#5551FF]">
            <div className="min-w-[760px]">
              {/* Table Header */}
              <div className="grid grid-cols-12 border-b border-slate-100 text-xs font-semibold text-slate-400 py-3.5 pr-6 bg-slate-50">
                <div className="col-span-3 sticky left-0 z-10 bg-slate-50 -my-3.5 py-3.5 pl-6 pr-3">Name</div>
                <div className="col-span-3">Email</div>
                <div className="col-span-2 text-center">Account</div>
                <div className="col-span-2">Phone</div>
                <div className="col-span-2 text-right">Location</div>
              </div>

              {/* Table Rows */}
              <div className="divide-y divide-slate-100">
                {employees.map((emp) => (
                  <div
                    key={emp.id}
                    className="grid grid-cols-12 items-center py-4 pr-6 bg-white hover:bg-slate-50 transition-colors text-xs text-slate-700 group"
                  >
                    {/* Name with initials circle */}
                    <div className="col-span-3 sticky left-0 z-10 flex items-center gap-3 self-stretch bg-white group-hover:bg-slate-50 -my-4 py-4 pl-6 pr-3">
                      <div className="w-7 h-7 rounded-xl bg-purple-50 text-[#5551FF] flex items-center justify-center font-bold text-[11px] shrink-0 border border-purple-100">
                        {emp.initials}
                      </div>
                      <span className="font-semibold text-slate-900 truncate">
                        {emp.name}
                      </span>
                    </div>

                    {/* Email */}
                    <div className="col-span-3 text-slate-600 truncate pr-2">
                      {emp.email}
                    </div>

                    {/* Account Status Badge */}
                    <div className="col-span-2 flex justify-center">
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                        {emp.status}
                      </span>
                    </div>

                    {/* Phone */}
                    <div className="col-span-2 text-slate-600 font-mono text-[11px] truncate">
                      {emp.phone}
                    </div>

                    {/* Location & Delete */}
                    <div className="col-span-2 flex items-center justify-end gap-3 text-slate-500">
                      <span className="truncate">{emp.location}</span>
                      <button
                        onClick={() => onDeleteEmployee(emp.id)}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-slate-500 hover:text-rose-500 hover:bg-rose-50 rounded-lg focus-visible:outline-2 focus-visible:outline-[#5551FF]"
                        aria-label={`Delete ${emp.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
