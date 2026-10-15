import React, { useEffect, useRef, useState } from 'react';
import {
  HelpCircle,
  Camera,
  Plus,
  Trash2,
  Check,
} from 'lucide-react';
import { CompanySettingsData, BookingHoursDay, SettingsSubTab, ClosedDate, StaffAbsence, Employee } from '../types';
import { formatDate, getSalonNow } from '../scheduling';
import { normalizeWebsiteUrl, validateLogoFile } from '../managementValidation';

interface SettingsViewProps {
  settings: CompanySettingsData;
  bookingHours: BookingHoursDay[];
  onSaveSettings: (settings: CompanySettingsData, hours: BookingHoursDay[]) => void;
  closedDates: ClosedDate[];
  absences: StaffAbsence[];
  employees: Employee[];
  onSaveClosedDates: (dates: ClosedDate[]) => void;
  onSaveAbsences: (items: StaffAbsence[]) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings: initialSettings,
  bookingHours: initialBookingHours,
  onSaveSettings,
  closedDates, absences, employees, onSaveClosedDates, onSaveAbsences,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsSubTab>('basic');
  const [formData, setFormData] = useState<CompanySettingsData>(initialSettings);
  const [hoursData, setHoursData] = useState<BookingHoursDay[]>(() => initialBookingHours.map((day) => ({ ...day })));
  const [closedDatesTab, setClosedDatesTab] = useState<'closed' | 'absences'>('closed');
  const [showHelp, setShowHelp] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [logoError, setLogoError] = useState('');
  const [logoLoading, setLogoLoading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const logoRequest = useRef(0);
  useEffect(() => () => { logoRequest.current += 1; }, []);
  const [dateError, setDateError] = useState('');
  const [dateFeedback, setDateFeedback] = useState('');
  const [editingDateId, setEditingDateId] = useState<string | null>(null);
  const [dateName, setDateName] = useState('');
  const [absenceEmployeeId, setAbsenceEmployeeId] = useState('');
  const [rangeStart, setRangeStart] = useState(() => getSalonNow(initialSettings.timeZone).date);
  const [rangeEnd, setRangeEnd] = useState(() => getSalonNow(initialSettings.timeZone).date);
  const dateInputClass = 'min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-none focus:ring-2 focus:ring-[#5551FF]/20';
  const hasSettingsChanges = JSON.stringify(formData) !== JSON.stringify(initialSettings) || JSON.stringify(hoursData) !== JSON.stringify(initialBookingHours);

  const resetDateForm = () => {
    setEditingDateId(null); setDateName(''); setAbsenceEmployeeId('');
    const today = getSalonNow(formData.timeZone).date;
    setRangeStart(today); setRangeEnd(today); setDateError('');
  };

  const isValidDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };

  const saveDateRange = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValidDate(rangeStart) || !isValidDate(rangeEnd) || rangeEnd < rangeStart) { setDateError('Choose valid dates with the last day on or after the first day.'); return; }
    if (closedDatesTab === 'closed') {
      if (!dateName.trim()) { setDateError('Enter a name for this closure.'); return; }
      if (closedDates.some((item) => item.id !== editingDateId && item.start === rangeStart && item.end === rangeEnd)) { setDateError('A closure already covers these exact dates. Edit that closure instead.'); return; }
      const entry: ClosedDate = { id: editingDateId || `closed-${crypto.randomUUID()}`, name: dateName.trim(), start: rangeStart, end: rangeEnd };
      onSaveClosedDates([...closedDates.filter((item) => item.id !== editingDateId), entry].sort((a, b) => a.start.localeCompare(b.start)));
      setDateFeedback('Closure saved. Online booking availability is updated.');
    } else {
      if (!employees.some((employee) => employee.id === absenceEmployeeId)) { setDateError('Choose the employee who will be absent.'); return; }
      if (absences.some((item) => item.id !== editingDateId && item.employeeId === absenceEmployeeId && item.start === rangeStart && item.end === rangeEnd)) { setDateError('This employee already has an absence for these dates.'); return; }
      const entry: StaffAbsence = { id: editingDateId || `absence-${crypto.randomUUID()}`, employeeId: absenceEmployeeId, start: rangeStart, end: rangeEnd, reason: dateName.trim() };
      onSaveAbsences([...absences.filter((item) => item.id !== editingDateId), entry].sort((a, b) => a.start.localeCompare(b.start)));
      setDateFeedback('Absence saved. Online booking availability is updated.');
    }
    resetDateForm();
  };
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);

  const handleToggleDay = (index: number) => {
    setHoursData((previous) => previous.map((day, i) => i === index ? { ...day, isOpen: !day.isOpen } : day));
  };

  const handleTimeChange = (index: number, field: 'from' | 'to', value: string) => {
    setHoursData((previous) => previous.map((day, i) => i === index ? { ...day, [field]: value } : day));
  };

  const handleLogoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const request = ++logoRequest.current;
    const error = validateLogoFile(file);
    setLogoError(error ?? '');
    if (error) { setLogoLoading(false); return; }
    setLogoLoading(true);
    const fail = () => { if (request === logoRequest.current) { setLogoError('This image could not be opened. Choose another PNG, JPEG or WebP file.'); setLogoLoading(false); } };
    const reader = new FileReader();
    reader.onerror = fail;
    reader.onload = () => {
      if (request !== logoRequest.current) return;
      if (typeof reader.result !== 'string') { fail(); return; }
      const dataUrl = reader.result;
      const image = new Image();
      image.onerror = fail;
      image.onload = () => {
        if (request !== logoRequest.current) return;
        setFormData((previous) => ({ ...previous, logoDataUrl: dataUrl }));
        setLogoLoading(false);
      };
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!formData.companyName.trim()) { setSettingsError('Enter a company name.'); setActiveTab('basic'); return; }
    const invalidDay = hoursData.find((day) => day.isOpen && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(day.from) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(day.to) || day.to <= day.from));
    if (invalidDay) { setSettingsError(`${invalidDay.day}: closing time must be after opening time on the same day.`); setActiveTab('hours'); return; }
    const links: Partial<CompanySettingsData> = {};
    for (const [key, label, allowMissingScheme] of [['website', 'Website', false], ['legalNote', 'Legal note', false], ['facebook', 'Facebook', true], ['xProfile', 'X profile', true], ['instagram', 'Instagram', true]] as const) {
      const url = normalizeWebsiteUrl(formData[key], allowMissingScheme);
      if (url === null) { setSettingsError(`${label}: enter a complete http:// or https:// link with a valid host, or leave it blank.`); setActiveTab('profile'); return; }
      links[key] = url;
    }
    if (formData.customTerms && !formData.termsText?.trim()) { setSettingsError('Enter your custom terms and privacy text, or turn off custom terms.'); setActiveTab('profile'); return; }
    setSettingsError('');
    const normalizedSettings = { ...Object.fromEntries(Object.entries(formData).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])), ...links } as unknown as CompanySettingsData;
    setFormData(normalizedSettings);
    onSaveSettings(normalizedSettings, hoursData);
    setShowSavedFeedback(true);
    setTimeout(() => setShowSavedFeedback(false), 2500);
  };

  return (
    <div className="min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Header matching Figma Page 21, 35 */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          Company Settings
        </h1>

        <div className="flex items-center gap-3">
          <button
            className="p-2 text-slate-400 hover:text-slate-600 rounded-full"
            title="Help"
            aria-label="Settings help"
            aria-expanded={showHelp}
            onClick={() => setShowHelp((previous) => !previous)}
          >
            <HelpCircle className="w-5 h-5" />
          </button>

          <button
            onClick={handleSave}
            disabled={logoLoading}
            className="flex min-h-11 items-center gap-1.5 px-6 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors disabled:opacity-50"
          >
            {showSavedFeedback && !hasSettingsChanges ? (
              <>
                <Check className="w-4 h-4" />
                <span>Saved!</span>
              </>
            ) : (
              <span>Save</span>
            )}
          </button>
        </div>
      </div>

      {showHelp && <p className="p-4 rounded-xl bg-indigo-50 text-sm text-indigo-900">Save company details and weekly hours with the Save button. Closures and staff absences save individually and immediately change booking availability. Existing appointments remain on the calendar.</p>}
      {settingsError && <p role="alert" className="p-3 rounded-xl bg-rose-50 text-sm text-rose-700">{settingsError}</p>}
      {hasSettingsChanges && <p role="status" className="text-xs text-amber-700">You have unsaved company details or booking hours. Select Save to apply them.</p>}
      {/* Main Settings Body: Left Sub-tabs & Right Panel */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* Left Sub-nav (span 3) */}
        <div className="md:col-span-3 bg-white rounded-2xl border border-slate-200/80 p-2 shadow-xs space-y-1 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('basic')}
            className={`w-full text-left px-4 py-2.5 rounded-xl transition-colors ${
              activeTab === 'basic'
                ? 'bg-[#5551FF]/12 text-[#5551FF]'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Basic Information
          </button>

          <button
            onClick={() => setActiveTab('hours')}
            className={`w-full text-left px-4 py-2.5 rounded-xl transition-colors ${
              activeTab === 'hours'
                ? 'bg-[#5551FF]/12 text-[#5551FF]'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Booking Hours
          </button>

          <button
            onClick={() => setActiveTab('closed-dates')}
            className={`w-full text-left px-4 py-2.5 rounded-xl transition-colors ${
              activeTab === 'closed-dates'
                ? 'bg-[#5551FF]/12 text-[#5551FF]'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Closed Dates and Absences
          </button>

          <button
            onClick={() => setActiveTab('profile')}
            className={`w-full text-left px-4 py-2.5 rounded-xl transition-colors ${
              activeTab === 'profile'
                ? 'bg-[#5551FF]/12 text-[#5551FF]'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Company Profile
          </button>
        </div>

        {/* Right Content Panel (span 9) */}
        <div className="md:col-span-9 bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-xs">
          {/* TAB 1: Basic Information */}
          {activeTab === 'basic' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
                Basic Information
              </h2>

              <div className="grid grid-cols-1 2xl:grid-cols-12 gap-8 items-start">
                {/* Form fields (col 8) */}
                <div className="min-w-0 2xl:col-span-8 space-y-4 text-xs">
                  <div>
                    <label htmlFor="company-companyName" className="font-semibold text-slate-700 block mb-1">
                      Company name
                    </label>
                    <input id="company-companyName"
                      type="text"
                      value={formData.companyName}
                      onChange={(e) =>
                        setFormData({ ...formData, companyName: e.target.value })
                      }
                      className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                    />
                  </div>

                  {/* Street & Postal & City */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label htmlFor="company-street" className="font-semibold text-slate-700 block mb-1">
                        Street and number
                      </label>
                    <input id="company-street"
                        type="text"
                        value={formData.street}
                        onChange={(e) =>
                          setFormData({ ...formData, street: e.target.value })
                        }
                        className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                      />
                    </div>
                    <div>
                      <label htmlFor="company-postalCode" className="font-semibold text-slate-700 block mb-1">
                        Postal code
                      </label>
                    <input id="company-postalCode"
                        type="text"
                        value={formData.postalCode}
                        onChange={(e) =>
                          setFormData({ ...formData, postalCode: e.target.value })
                        }
                        className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                      />
                    </div>
                    <div>
                      <label htmlFor="company-city" className="font-semibold text-slate-700 block mb-1">
                        City
                      </label>
                    <input id="company-city"
                        type="text"
                        value={formData.city}
                        onChange={(e) =>
                          setFormData({ ...formData, city: e.target.value })
                        }
                        className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                      />
                    </div>
                  </div>

                  {/* Country & State */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="company-country" className="font-semibold text-slate-700 block mb-1">
                        Country
                      </label>
                    <select id="company-country"
                        value={formData.country}
                        onChange={(e) =>
                          setFormData({ ...formData, country: e.target.value })
                        }
                        className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                      >
                        <option value="Switzerland">Switzerland</option>
                        <option value="Germany">Germany</option>
                        <option value="Austria">Austria</option>
                        <option value="France">France</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="company-state" className="font-semibold text-slate-700 block mb-1">
                        State/Province
                      </label>
                    <input id="company-state"
                        type="text"
                        value={formData.state}
                        onChange={(e) =>
                          setFormData({ ...formData, state: e.target.value })
                        }
                        className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                      />
                    </div>
                  </div>

                  {/* Industry & Phone */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="company-industry" className="font-semibold text-slate-700 block mb-1">
                        Industry
                      </label>
                    <select id="company-industry"
                        value={formData.industry}
                        onChange={(e) =>
                          setFormData({ ...formData, industry: e.target.value })
                        }
                        className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                      >
                        <option value="Hair & Beauty">Hair & Beauty</option>
                        <option value="Spa & Wellness">Spa & Wellness</option>
                        <option value="Barbershop">Barbershop</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="company-businessPhone" className="font-semibold text-slate-700 block mb-1">
                        Business phone
                      </label>
                    <input id="company-businessPhone"
                        type="text"
                        value={formData.businessPhone}
                        onChange={(e) =>
                          setFormData({ ...formData, businessPhone: e.target.value })
                        }
                        className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                      />
                    </div>
                  </div>

                  {/* Currency & Language */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="company-currency" className="font-semibold text-slate-700 block mb-1">
                        Currency
                      </label>
                    <input id="company-currency"
                        type="text"
                        disabled
                        value={formData.currency}
                        className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-slate-400"
                      />
                    </div>
                    <div>
                      <label htmlFor="company-branchLanguage" className="font-semibold text-slate-700 block mb-1">
                        Branch language setting
                      </label>
                    <select id="company-branchLanguage"
                        value={formData.branchLanguage}
                        onChange={(e) =>
                          setFormData({ ...formData, branchLanguage: e.target.value })
                        }
                        className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                      >
                        <option value="English">English</option>
                        <option value="German">German</option>
                        <option value="French">French</option>
                        <option value="Italian">Italian</option>
                      </select>
                    </div>
                  </div>

                  {/* Time zone */}
                  <div>
                    <label htmlFor="company-timeZone" className="font-semibold text-slate-700 block mb-1">
                      Time zone
                    </label>
                    <select id="company-timeZone"
                      value={formData.timeZone}
                      onChange={(e) =>
                        setFormData({ ...formData, timeZone: e.target.value })
                      }
                      className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                    >
                      <option value="Europe/Zurich (GMT+01:00)">
                        Europe/Zurich (GMT+01:00)
                      </option>
                      <option value="Europe/Paris (GMT+01:00)">
                        Europe/Paris (GMT+01:00)
                      </option>
                      <option value="Europe/London (GMT+00:00)">
                        Europe/London (GMT+00:00)
                      </option>
                    </select>
                  </div>
                </div>

                {/* Company Logo Upload Box (col 4) matching Figma Page 21 */}
                <div className="2xl:col-span-4 space-y-2 text-xs">
                  <label className="font-semibold text-slate-700 block">
                    Company logo
                  </label>
                  <div className="w-40 h-40 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden">
                    {formData.logoDataUrl ? <img src={formData.logoDataUrl} alt="Company logo preview" className="h-full w-full object-contain" /> : <Camera className="w-8 h-8 text-slate-400" />}
                  </div>
                  <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoChange} className="sr-only" aria-label="Choose company logo" />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => logoInputRef.current?.click()} disabled={logoLoading} className="min-h-11 rounded-lg bg-indigo-50 px-3 font-semibold text-[#5551FF] disabled:opacity-50">{logoLoading ? 'Opening image…' : formData.logoDataUrl ? 'Change logo' : 'Upload logo'}</button>
                    {formData.logoDataUrl && <button type="button" onClick={() => { logoRequest.current += 1; setFormData((previous) => ({ ...previous, logoDataUrl: undefined })); setLogoLoading(false); setLogoError(''); }} className="min-h-11 rounded-lg px-3 font-semibold text-rose-600">Remove logo</button>}
                  </div>
                  <p className="text-slate-500">PNG, JPEG or WebP, up to 500 KB. Select Save to apply the logo in this demo.</p>
                  {logoError && <p role="alert" className="text-rose-700">{logoError}</p>}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Booking Hours */}
          {activeTab === 'hours' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
                Booking Hours
              </h2>

              <div className="space-y-4 max-w-2xl text-xs">
                {hoursData.map((item, index) => (
                  <div
                    key={item.day}
                    className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-3 py-2.5 border-b border-slate-100"
                  >
                    {/* Day & Open/Closed Switch */}
                    <div className="flex w-full max-w-xs items-center justify-between gap-4">
                      <span className="font-bold text-slate-800 w-24">
                        {item.day}
                      </span>

                      <label className="relative flex min-h-11 items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          aria-label={`${item.day} open for booking`}
                          checked={item.isOpen}
                          onChange={() => handleToggleDay(index)}
                          className="sr-only peer"
                        />
                        <div className="relative w-9 h-5 shrink-0 bg-slate-200 rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-[#5551FF] peer-focus-visible:ring-offset-2 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#5551FF]" />
                        <span className="text-xs font-semibold text-slate-600">
                          {item.isOpen ? 'Open' : 'Closed'}
                        </span>
                      </label>
                    </div>

                    {/* From - To Hours */}
                    {item.isOpen ? (
                      <div className="grid w-full max-w-sm grid-cols-2 gap-3">
                        <label className="min-w-0 space-y-1 text-slate-500"><span>From</span>
                        <input type="time" value={item.from} aria-label={`${item.day} opening time`} onChange={(event) => handleTimeChange(index, 'from', event.target.value)} className="block min-h-11 min-w-0 w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-base sm:text-sm" /></label>
                        <label className="min-w-0 space-y-1 text-slate-500"><span>To</span>
                        <input type="time" value={item.to} aria-label={`${item.day} closing time`} onChange={(event) => handleTimeChange(index, 'to', event.target.value)} className="block min-h-11 min-w-0 w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-base sm:text-sm" /></label>
                      </div>
                    ) : (
                      <span className="text-slate-400 text-xs italic">
                        Closed all day
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: Closed Dates and Absences */}
          {activeTab === 'closed-dates' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">Closed Dates and Absences</h2>
                <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-semibold">
                  {(['closed', 'absences'] as const).map((tab) => <button key={tab} aria-pressed={closedDatesTab === tab} onClick={() => { setClosedDatesTab(tab); resetDateForm(); setDateFeedback(''); }} className={`px-3 py-1.5 rounded-lg ${closedDatesTab === tab ? 'bg-[#5551FF] text-white' : 'text-slate-600'}`}>{tab === 'closed' ? 'Closed Dates' : 'Absences'}</button>)}
                </div>
              </div>
              <p className="text-xs text-slate-500">{closedDatesTab === 'closed' ? 'Close the whole salon for a holiday or another one-off event.' : 'Block booking for one employee while they are away.'} Both the first and last day are included. Changes save immediately; existing appointments are kept.</p>
              <div className="space-y-2">
                {closedDatesTab === 'closed' ? closedDates.map((item) => <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                  <div className="flex-1 min-w-0"><p className="font-semibold text-slate-800">{item.name}</p><p className="text-slate-500 mt-1">{formatDate(item.start)}{item.end !== item.start && ` to ${formatDate(item.end)}`}</p></div>
                  <button className="min-h-11 min-w-11 font-semibold text-[#5551FF]" aria-label={`Edit ${item.name}`} onClick={() => { setEditingDateId(item.id); setDateName(item.name); setRangeStart(item.start); setRangeEnd(item.end); setDateError(''); setDateFeedback(''); }}>Edit</button>
                  <button className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-[#5551FF]" aria-label={`Delete ${item.name}`} onClick={() => { onSaveClosedDates(closedDates.filter((date) => date.id !== item.id)); if (editingDateId === item.id) resetDateForm(); setDateFeedback('Closure removed. Booking availability is updated.'); }}><Trash2 className="w-4 h-4" /></button>
                </div>) : absences.map((item) => {
                  const employeeName = employees.find((employee) => employee.id === item.employeeId)?.name || 'Removed employee';
                  return <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                    <div className="flex-1 min-w-0"><p className="font-semibold text-slate-800">{employeeName}{item.reason && `: ${item.reason}`}</p><p className="text-slate-500 mt-1">{formatDate(item.start)}{item.end !== item.start && ` to ${formatDate(item.end)}`}</p></div>
                    <button className="min-h-11 min-w-11 font-semibold text-[#5551FF]" aria-label={`Edit absence for ${employeeName}`} onClick={() => { setEditingDateId(item.id); setDateName(item.reason || ''); setAbsenceEmployeeId(item.employeeId); setRangeStart(item.start); setRangeEnd(item.end); setDateError(''); setDateFeedback(''); }}>Edit</button>
                    <button className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-[#5551FF]" aria-label={`Delete absence for ${employeeName}`} onClick={() => { onSaveAbsences(absences.filter((absence) => absence.id !== item.id)); if (editingDateId === item.id) resetDateForm(); setDateFeedback('Absence removed. Booking availability is updated.'); }}><Trash2 className="w-4 h-4" /></button>
                  </div>;
                })}
                {(closedDatesTab === 'closed' ? closedDates.length : absences.length) === 0 && <p className="py-4 text-sm text-slate-500">{closedDatesTab === 'closed' ? 'No one-off closures added.' : 'No staff absences added.'}</p>}
              </div>
              {dateFeedback && <p role="status" className="rounded-xl bg-emerald-50 text-emerald-800 p-3 text-xs">{dateFeedback}</p>}
              <form onSubmit={saveDateRange} className="border-t border-slate-100 pt-5 space-y-4 text-xs">
                <h3 className="font-semibold text-slate-800">{editingDateId ? 'Edit' : 'Add'} {closedDatesTab === 'closed' ? 'closure' : 'staff absence'}</h3>
                {closedDatesTab === 'absences' && <div><label htmlFor="absence-employee" className="block mb-1 font-semibold text-slate-700">Employee</label><select id="absence-employee" required value={absenceEmployeeId} onChange={(event) => setAbsenceEmployeeId(event.target.value)} className={dateInputClass}><option value="">Choose employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></div>}
                <div><label htmlFor="closure-name" className="block mb-1 font-semibold text-slate-700">{closedDatesTab === 'closed' ? 'Closure name' : 'Reason (optional)'}</label><input id="closure-name" required={closedDatesTab === 'closed'} value={dateName} onChange={(event) => setDateName(event.target.value)} placeholder={closedDatesTab === 'closed' ? 'For example, public holiday' : 'For example, annual leave'} className={dateInputClass} /></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label htmlFor="closure-start" className="block mb-1 font-semibold text-slate-700">First day</label><input id="closure-start" type="date" required value={rangeStart} onChange={(event) => { setRangeStart(event.target.value); if (rangeEnd < event.target.value) setRangeEnd(event.target.value); }} className={dateInputClass} /></div>
                  <div><label htmlFor="closure-end" className="block mb-1 font-semibold text-slate-700">Last day</label><input id="closure-end" type="date" required min={rangeStart} value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} className={dateInputClass} /></div>
                </div>
                {dateError && <p role="alert" className="rounded-xl p-3 bg-rose-50 text-rose-700">{dateError}</p>}
                <div className="flex gap-3"><button type="submit" disabled={closedDatesTab === 'absences' && employees.length === 0} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5551FF] text-white font-semibold disabled:opacity-50">{editingDateId ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}Save {closedDatesTab === 'closed' ? 'closure' : 'absence'}</button>{editingDateId && <button type="button" onClick={resetDateForm} className="px-4 py-2 rounded-xl text-slate-600 bg-slate-100 font-semibold">Cancel</button>}</div>
              </form>
            </div>
          )}

          {/* TAB 4: Company Profile */}
          {activeTab === 'profile' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
                Company Profile
              </h2>

              <div className="space-y-4 max-w-2xl text-xs">
                <div>
                  <label htmlFor="company-description" className="font-semibold text-slate-700 block mb-1">
                    Company Description
                  </label>
                    <textarea id="company-description"
                    rows={3}
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    placeholder="Tell customers about your salon..."
                    className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label htmlFor="company-website" className="font-semibold text-slate-700 block mb-1">
                    Link to your website
                  </label>
                    <input id="company-website"
                    type="url"
                    value={formData.website}
                    onChange={(e) =>
                      setFormData({ ...formData, website: e.target.value })
                    }
                    className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label htmlFor="company-facebook" className="font-semibold text-slate-700 block mb-1">
                    Link to your Facebook profile
                  </label>
                    <input id="company-facebook"
                    type="text"
                    value={formData.facebook}
                    onChange={(e) =>
                      setFormData({ ...formData, facebook: e.target.value })
                    }
                    className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label htmlFor="company-xProfile" className="font-semibold text-slate-700 block mb-1">
                    Link to your X profile
                  </label>
                    <input id="company-xProfile"
                    type="text"
                    value={formData.xProfile}
                    onChange={(e) =>
                      setFormData({ ...formData, xProfile: e.target.value })
                    }
                    className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label htmlFor="company-instagram" className="font-semibold text-slate-700 block mb-1">
                    Link to your Instagram profile
                  </label>
                    <input id="company-instagram"
                    type="text"
                    value={formData.instagram}
                    onChange={(e) =>
                      setFormData({ ...formData, instagram: e.target.value })
                    }
                    className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label htmlFor="company-legalNote" className="font-semibold text-slate-700 block mb-1">
                    Link to your legal note
                  </label>
                    <input id="company-legalNote"
                    type="url"
                    value={formData.legalNote}
                    onChange={(e) =>
                      setFormData({ ...formData, legalNote: e.target.value })
                    }
                    className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  />
                </div>

                <div className="pt-2">
                  <label className="relative flex min-h-11 items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.customTerms}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          customTerms: e.target.checked,
                        })
                      }
                      className="sr-only peer"
                    />
                    <div className="relative w-9 h-5 shrink-0 bg-slate-200 rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-[#5551FF] peer-focus-visible:ring-offset-2 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#5551FF]" />
                    <span className="text-xs font-semibold text-slate-700">
                      Define custom terms & conditions and data privacy text for the booking page
                    </span>
                  </label>
                  {formData.customTerms && (
                    <div className="mt-3">
                      <label htmlFor="company-termsText" className="mb-1 block text-xs font-semibold text-slate-700">Custom terms and privacy text</label>
                      <textarea id="company-termsText" rows={6} value={formData.termsText ?? ''} onChange={(event) => setFormData({ ...formData, termsText: event.target.value })} className="min-h-11 min-w-0 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-base focus:border-[#5551FF] focus:outline-hidden sm:text-sm" />
                      <p className="mt-1 text-xs text-slate-500">This text appears on the customer booking page after you select Save.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
