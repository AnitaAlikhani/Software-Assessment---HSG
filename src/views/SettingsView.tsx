import React, { useEffect, useRef, useState } from 'react';
import {
  HelpCircle,
  Camera,
  Plus,
  Trash2,
  Check,
} from 'lucide-react';
import { CompanySettingsData, BookingHoursDay, SettingsSubTab, ClosedDate } from '../types';
import { salonTimeZone } from '../scheduling';
import { normalizeWebsiteUrl, validateLogoFile } from '../managementValidation';
import { phoneAdvice } from '../bookingData';
import { formatDateRange, formatPhone, formatTime, normalizePhone, timeZoneLabel } from '../format';
import { CANTONS, COUNTRIES, SALON_TIME_ZONE, countryOf, regionToSave } from '../region';
import { SETTINGS_TABS } from '../navigation';
import { dateRangeFieldClass, useDateRangeForm } from '../dateRangeForm';
import { SectionTabs, sectionPanel } from '../components/SectionTabs';
import { BookingLinkCard } from '../components/BookingLinkCard';

/** Opening and closing times are chosen on the half hour, the step appointments start on. */
const HALF_HOURS = Array.from({ length: 48 }, (_, index) => formatTime(index * 30));
const onHalfHour = (time: string): boolean => HALF_HOURS.includes(time);
/**
 * The times one field offers: the half hours, plus the field's own time when it is not one of
 * them. A time saved earlier (09:07) then still shows and is kept until the owner picks another.
 */
const timeChoices = (time: string): string[] => onHalfHour(time) ? HALF_HOURS : [...HALF_HOURS, time].sort();
/** Says so under a day whose times are not on the half hour, instead of changing them silently. Null for a day that needs no note. */
const offHalfHourNote = (day: BookingHoursDay): string | null => {
  const kept = [day.from, day.to].filter((time) => time && !onHalfHour(time));
  if (kept.length === 0) return null;
  return `${kept.join(' and ')} ${kept.length === 1 ? 'is' : 'are'} not on the half hour. ${kept.length === 1 ? 'It stays' : 'They stay'} as saved until you choose another time. Appointments start on the half hour.`;
};

/**
 * The stored settings as the form shows them: the phone number written out, the time zone as a
 * plain id. Comparing the form with this tells whether the owner changed something.
 */
const asShown = (settings: CompanySettingsData): CompanySettingsData =>
  ({ ...settings, businessPhone: formatPhone(settings.businessPhone), timeZone: salonTimeZone(settings.timeZone) });

interface SettingsViewProps {
  settings: CompanySettingsData;
  bookingHours: BookingHoursDay[];
  onSaveSettings: (settings: CompanySettingsData, hours: BookingHoursDay[]) => void;
  closedDates: ClosedDate[];
  onSaveClosedDates: (dates: ClosedDate[]) => void;
  /** The moment "today" is taken from. Tests pass a fixed one; the app leaves it out and gets the current time. */
  now?: Date;
  /** The tab that is open. Left out, it is Salon. The app keeps it in the address, so a link can lead to one tab. */
  tab?: SettingsSubTab;
  onTabChange?: (tab: SettingsSubTab) => void;
  /** The address customers book at. Left out, it is this site's own. */
  bookingLink?: string;
  /** Leads to Team › Absences, where one person's days off are entered. The link is shown only when it has a target. */
  onOpenAbsences?: () => void;
  /** While salon details or opening hours are changed and not saved: the question to ask before another screen is opened. */
  onUnsavedChange?: (question: string | null) => void;
}

/**
 * Settings: what is true for the whole salon. "Salon" holds its name, address and what customers
 * read about it; "Opening hours" the regular week; "Closed dates" the days the whole salon is
 * shut; "Online booking" the link customers book with.
 */
export const SettingsView: React.FC<SettingsViewProps> = ({
  settings: initialSettings,
  bookingHours: initialBookingHours,
  onSaveSettings,
  closedDates, onSaveClosedDates, now, tab, onTabChange, bookingLink, onOpenAbsences, onUnsavedChange,
}) => {
  // Without an owner of the tab (a test, a page that does not keep it in the address) the page keeps it itself.
  const [ownTab, setOwnTab] = useState<SettingsSubTab>(tab ?? 'salon');
  const activeTab = onTabChange ? tab ?? 'salon' : ownTab;
  const setActiveTab = (next: SettingsSubTab) => { setOwnTab(next); onTabChange?.(next); };
  // The form opens on the launch market's choices: a country and a time zone saved before the
  // market was narrowed show as Switzerland and Swiss time, and count as a change still to save.
  const [formData, setFormData] = useState<CompanySettingsData>(() =>
    ({ ...asShown(initialSettings), country: countryOf(initialSettings.country), timeZone: SALON_TIME_ZONE }));
  const [hoursData, setHoursData] = useState<BookingHoursDay[]>(() => initialBookingHours.map((day) => ({ ...day })));
  const [showHelp, setShowHelp] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [logoError, setLogoError] = useState('');
  const [logoLoading, setLogoLoading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const logoRequest = useRef(0);
  useEffect(() => () => { logoRequest.current += 1; }, []);
  const closure = useDateRangeForm(formData.timeZone, now, 'closure-name');
  const hasSettingsChanges = JSON.stringify(formData) !== JSON.stringify(asShown(initialSettings)) || JSON.stringify(hoursData) !== JSON.stringify(initialBookingHours);
  // Save applies to Salon and Opening hours. On the other tabs it is only there while something waits to be saved.
  const saveShown = activeTab === 'salon' || activeTab === 'hours' || hasSettingsChanges;
  // Leaving for another screen (the menu, the tab bar, Back) asks first while something is unsaved.
  useEffect(() => {
    onUnsavedChange?.(hasSettingsChanges ? 'Leave Settings without saving? Your changes to the salon details or opening hours are not saved yet.' : null);
    return () => onUnsavedChange?.(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSettingsChanges]);

  const saveClosure = (event: React.FormEvent) => {
    event.preventDefault();
    const rangeError = closure.rangeError();
    if (rangeError) { closure.setError(rangeError); return; }
    if (!closure.text.trim()) { closure.setError('Enter a name for this closure.'); return; }
    if (closedDates.some((item) => item.id !== closure.editingId && item.start === closure.start && item.end === closure.end)) { closure.setError('A closure already covers these exact dates. Edit that closure instead.'); return; }
    const entry: ClosedDate = { id: closure.editingId || `closed-${crypto.randomUUID()}`, name: closure.text.trim(), start: closure.start, end: closure.end };
    onSaveClosedDates([...closedDates.filter((item) => item.id !== closure.editingId), entry].sort((a, b) => a.start.localeCompare(b.start)));
    closure.setFeedback('Closure saved. Online booking availability is updated.');
    closure.reset();
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
    if (!formData.companyName.trim()) { setSettingsError('Enter a company name.'); setActiveTab('salon'); return; }
    const phoneIssue = formData.businessPhone.trim() ? phoneAdvice(formData.businessPhone) : null;
    if (phoneIssue) { setSettingsError(`Business phone: ${phoneIssue} Or leave the field blank.`); setActiveTab('salon'); return; }
    const invalidDay = hoursData.find((day) => day.isOpen && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(day.from) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(day.to) || day.to <= day.from));
    if (invalidDay) { setSettingsError(`${invalidDay.day}: closing time must be after opening time on the same day.`); setActiveTab('hours'); return; }
    const links: Partial<CompanySettingsData> = {};
    for (const [key, label, allowMissingScheme] of [['website', 'Website', false], ['legalNote', 'Legal notice', false], ['facebook', 'Facebook', true], ['xProfile', 'X profile', true], ['instagram', 'Instagram', true]] as const) {
      const url = normalizeWebsiteUrl(formData[key], allowMissingScheme);
      if (url === null) { setSettingsError(`${label}: enter a complete http:// or https:// link with a valid host, or leave it blank.`); setActiveTab('salon'); return; }
      links[key] = url;
    }
    if (formData.customTerms && !formData.termsText?.trim()) { setSettingsError('Enter your custom terms and privacy text, or turn off custom terms.'); setActiveTab('salon'); return; }
    setSettingsError('');
    const normalizedSettings = {
      ...Object.fromEntries(Object.entries(formData).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])),
      ...links,
      // The country, its canton (Liechtenstein has none) and the market's time zone.
      ...regionToSave(formData.country, formData.canton),
      // Stored once, in the international form; every screen writes it out the same way.
      businessPhone: formData.businessPhone.trim() ? normalizePhone(formData.businessPhone) : '',
    } as unknown as CompanySettingsData;
    setFormData(asShown(normalizedSettings));
    onSaveSettings(normalizedSettings, hoursData);
    setShowSavedFeedback(true);
    setTimeout(() => setShowSavedFeedback(false), 2500);
  };

  return (
    <div className="min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          Settings
        </h1>

        <div className="flex items-center gap-3">
          <button
            className="inline-flex h-11 w-11 items-center justify-center text-slate-400 hover:text-slate-600 rounded-full"
            title="Help"
            aria-label="Settings help"
            aria-expanded={showHelp}
            onClick={() => setShowHelp((previous) => !previous)}
          >
            <HelpCircle className="w-5 h-5" />
          </button>

          {saveShown && (
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
          )}
        </div>
      </div>

      {showHelp && <p className="p-4 rounded-xl bg-indigo-50 text-sm text-indigo-900">Save the salon’s details and its opening hours with the Save button. Closed dates save one by one and change booking availability at once. Existing appointments remain on the calendar.</p>}
      {settingsError && <p role="alert" className="p-3 rounded-xl bg-rose-50 text-sm text-rose-700">{settingsError}</p>}
      {hasSettingsChanges && <p role="status" className="text-xs text-amber-700">You have unsaved salon details or opening hours. Select Save to apply them.</p>}

      <SectionTabs label="Settings" tabs={SETTINGS_TABS} active={activeTab} onChange={setActiveTab} idPrefix="settings" />

      <div {...sectionPanel('settings', activeTab)} className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-xs">
          {/* Salon: the salon's details, then what customers read about it. One form, one Save. */}
          {activeTab === 'salon' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
                Salon
              </h2>

              <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
                {/* Form fields (col 8) */}
                <div className="min-w-0 xl:col-span-8 space-y-4 text-xs">
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
                        inputMode="numeric"
                        autoComplete="postal-code"
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

                  {/* Country & Canton. The canton follows the town in the address where the town alone does not say it ("Wil SG"). */}
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
                        {COUNTRIES.map((country) => <option key={country} value={country}>{country}</option>)}
                      </select>
                    </div>
                    {/* Liechtenstein has no cantons: the field is left out there. */}
                    {formData.country === 'Switzerland' && (
                    <div>
                      <label htmlFor="company-canton" className="font-semibold text-slate-700 block mb-1">
                        Canton
                      </label>
                    <select id="company-canton"
                        value={formData.canton ?? ''}
                        onChange={(e) =>
                          setFormData({ ...formData, canton: e.target.value })
                        }
                        className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                      >
                        <option value="">Choose a canton</option>
                        {CANTONS.map((canton) => <option key={canton.code} value={canton.code}>{canton.name} ({canton.code})</option>)}
                      </select>
                    </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="company-businessPhone" className="font-semibold text-slate-700 block mb-1">
                        Business phone
                      </label>
                    <input id="company-businessPhone"
                        type="tel"
                        autoComplete="tel"
                        placeholder="079 123 45 67"
                        value={formData.businessPhone}
                        onChange={(e) =>
                          setFormData({ ...formData, businessPhone: e.target.value })
                        }
                        className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                      />
                    </div>
                  </div>

                  {/* Time zone & Currency. Both follow from the country, so they are shown as text, not as fields. */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <p className="font-semibold text-slate-700 mb-1">Time zone</p>
                      <p className="flex min-h-11 items-center text-sm text-slate-700">{timeZoneLabel(formData.timeZone)}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-700 mb-1">Currency</p>
                      <p className="flex min-h-11 items-center text-sm text-slate-700">{formData.currency}</p>
                    </div>
                  </div>
                </div>

                {/* Company Logo Upload Box (col 4) matching Figma Page 21 */}
                <div className="xl:col-span-4 space-y-2 text-xs">
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
                  <p className="text-slate-500">PNG, JPEG or WebP, up to 500 KB. Select Save to apply the logo.</p>
                  {logoError && <p role="alert" className="text-rose-700">{logoError}</p>}
                </div>
              </div>

              {/* What customers read about the salon on its booking page. */}
              <h3 className="text-sm font-bold text-slate-900 border-t border-slate-100 pt-6">
                On your booking page
              </h3>

              <div className="space-y-4 max-w-2xl text-xs">
                <div>
                  <label htmlFor="company-description" className="font-semibold text-slate-700 block mb-1">
                    Company description
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
                    Link to your legal notice (imprint)
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

          {/* Opening hours */}
          {activeTab === 'hours' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
                Opening hours
              </h2>

              <div className="space-y-4 max-w-2xl text-xs">
                {hoursData.map((item, index) => (
                  <div
                    key={item.day}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2.5 border-b border-slate-100"
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
                      // Lists of 24-hour times, not the browser's time field: that one follows the
                      // device's language and shows "06:00 PM" on an English one.
                      <div className="grid w-full max-w-sm grid-cols-1 gap-3 min-[360px]:grid-cols-2">
                        <label className="min-w-0 space-y-1 text-slate-500"><span>From</span>
                        <select value={item.from} aria-label={`${item.day} opening time`} onChange={(event) => handleTimeChange(index, 'from', event.target.value)} className="block min-h-11 w-full min-w-[7.75rem] px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-base sm:text-sm text-slate-900 tabular-nums">
                          {timeChoices(item.from).map((time) => <option key={time} value={time}>{time}</option>)}
                        </select></label>
                        <label className="min-w-0 space-y-1 text-slate-500"><span>To</span>
                        <select value={item.to} aria-label={`${item.day} closing time`} onChange={(event) => handleTimeChange(index, 'to', event.target.value)} className="block min-h-11 w-full min-w-[7.75rem] px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-base sm:text-sm text-slate-900 tabular-nums">
                          {timeChoices(item.to).map((time) => <option key={time} value={time}>{time}</option>)}
                        </select></label>
                        {offHalfHourNote(item) && <p className="text-amber-700 min-[360px]:col-span-2">{offHalfHourNote(item)}</p>}
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

          {/* Closed dates: days on which the whole salon is shut. One person's days off are in Team › Absences. */}
          {activeTab === 'closed-dates' && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">Closed dates</h2>
              </div>
              <p className="text-xs text-slate-500">Close the whole salon for a holiday or another one-off event. Both the first and last day are included. Changes save immediately; existing appointments are kept.</p>
              {/* Absences stood on this tab before: say where they are now. */}
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                <span>Days off for one person are entered in Team, under Absences.</span>
                {onOpenAbsences && <button type="button" onClick={onOpenAbsences} className="inline-flex min-h-11 items-center font-semibold text-[#5551FF] underline hover:no-underline">Open Absences</button>}
              </p>
              <div className="space-y-2">
                {closedDates.map((item) => <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                  <div className="flex-1 min-w-0"><p className="font-semibold text-slate-800">{item.name}</p><p className="text-slate-500 mt-1 tabular-nums">{formatDateRange(item.start, item.end)}</p></div>
                  <button className="min-h-11 min-w-11 font-semibold text-[#5551FF]" aria-label={`Edit ${item.name}`} onClick={() => closure.edit(item, item.name)}>Edit</button>
                  <button className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-[#5551FF]" aria-label={`Delete ${item.name}`} onClick={() => { onSaveClosedDates(closedDates.filter((date) => date.id !== item.id)); if (closure.editingId === item.id) closure.reset(); closure.setFeedback('Closure removed. Booking availability is updated.'); }}><Trash2 className="w-4 h-4" /></button>
                </div>)}
                {closedDates.length === 0 && <p className="py-4 text-sm text-slate-500">No one-off closures added.</p>}
              </div>
              {closure.feedback && <p role="status" className="rounded-xl bg-emerald-50 text-emerald-800 p-3 text-xs">{closure.feedback}</p>}
              <form onSubmit={saveClosure} className="border-t border-slate-100 pt-5 space-y-4 text-xs">
                <h3 className="font-semibold text-slate-800">{closure.editingId ? 'Edit' : 'Add'} closure</h3>
                <div><label htmlFor="closure-name" className="block mb-1 font-semibold text-slate-700">Closure name</label><input id="closure-name" required value={closure.text} onChange={(event) => closure.setText(event.target.value)} placeholder="For example, public holiday" className={dateRangeFieldClass} /></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label htmlFor="closure-start" className="block mb-1 font-semibold text-slate-700">First day</label><input id="closure-start" type="date" required value={closure.start} onChange={(event) => closure.changeStart(event.target.value)} className={dateRangeFieldClass} /></div>
                  <div><label htmlFor="closure-end" className="block mb-1 font-semibold text-slate-700">Last day</label><input id="closure-end" type="date" required min={closure.start} value={closure.end} onChange={(event) => closure.setEnd(event.target.value)} className={dateRangeFieldClass} /></div>
                </div>
                {closure.error && <p role="alert" className="rounded-xl p-3 bg-rose-50 text-rose-700">{closure.error}</p>}
                <div className="flex gap-3"><button type="submit" className="inline-flex min-h-11 items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5551FF] text-white font-semibold disabled:opacity-50">{closure.editingId ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}Save closure</button>{closure.editingId && <button type="button" onClick={closure.reset} className="min-h-11 px-4 py-2 rounded-xl text-slate-600 bg-slate-100 font-semibold">Cancel</button>}</div>
              </form>
            </div>
          )}

          {/* Online booking: the link customers book with. The page itself is theirs; the owner needs its address. */}
          {activeTab === 'online-booking' && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">Online booking</h2>
              </div>
              <BookingLinkCard address={bookingLink} salonName={initialSettings.companyName} />
            </div>
          )}
      </div>
    </div>
  );
};
