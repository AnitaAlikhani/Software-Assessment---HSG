import React, { useState } from 'react';
import {
  HelpCircle,
  Camera,
  Plus,
  Trash2,
  Calendar,
  Check,
} from 'lucide-react';
import { CompanySettingsData, BookingHoursDay, SettingsSubTab } from '../types';

interface SettingsViewProps {
  settings: CompanySettingsData;
  bookingHours: BookingHoursDay[];
  onSaveSettings: (settings: CompanySettingsData, hours: BookingHoursDay[]) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings: initialSettings,
  bookingHours: initialBookingHours,
  onSaveSettings,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsSubTab>('basic');
  const [formData, setFormData] = useState<CompanySettingsData>(initialSettings);
  const [hoursData, setHoursData] = useState<BookingHoursDay[]>(initialBookingHours);
  const [closedDatesTab, setClosedDatesTab] = useState<'closed' | 'absences'>('closed');
  const [closedDatesList, setClosedDatesList] = useState<string[]>([]);
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);

  const handleToggleDay = (index: number) => {
    const updated = [...hoursData];
    updated[index].isOpen = !updated[index].isOpen;
    setHoursData(updated);
  };

  const handleTimeChange = (index: number, field: 'from' | 'to', value: string) => {
    const updated = [...hoursData];
    updated[index][field] = value;
    setHoursData(updated);
  };

  const handleSave = () => {
    onSaveSettings(formData, hoursData);
    setShowSavedFeedback(true);
    setTimeout(() => setShowSavedFeedback(false), 2500);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
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
          >
            <HelpCircle className="w-5 h-5" />
          </button>

          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-6 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors"
          >
            {showSavedFeedback ? (
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

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                {/* Form fields (col 8) */}
                <div className="lg:col-span-8 space-y-4 text-xs">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      Company name
                    </label>
                    <input
                      type="text"
                      value={formData.companyName}
                      onChange={(e) =>
                        setFormData({ ...formData, companyName: e.target.value })
                      }
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                    />
                  </div>

                  {/* Street & Postal & City */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-1">
                      <label className="font-semibold text-slate-700 block mb-1">
                        Street and number
                      </label>
                      <input
                        type="text"
                        value={formData.street}
                        onChange={(e) =>
                          setFormData({ ...formData, street: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                      />
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">
                        Postal code
                      </label>
                      <input
                        type="text"
                        value={formData.postalCode}
                        onChange={(e) =>
                          setFormData({ ...formData, postalCode: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                      />
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">
                        City
                      </label>
                      <input
                        type="text"
                        value={formData.city}
                        onChange={(e) =>
                          setFormData({ ...formData, city: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                      />
                    </div>
                  </div>

                  {/* Country & State */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">
                        Country
                      </label>
                      <select
                        value={formData.country}
                        onChange={(e) =>
                          setFormData({ ...formData, country: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                      >
                        <option value="Switzerland">Switzerland</option>
                        <option value="Germany">Germany</option>
                        <option value="Austria">Austria</option>
                        <option value="France">France</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">
                        State/Province
                      </label>
                      <input
                        type="text"
                        value={formData.state}
                        onChange={(e) =>
                          setFormData({ ...formData, state: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                      />
                    </div>
                  </div>

                  {/* Industry & Phone */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">
                        Industry
                      </label>
                      <select
                        value={formData.industry}
                        onChange={(e) =>
                          setFormData({ ...formData, industry: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                      >
                        <option value="Hair & Beauty">Hair & Beauty</option>
                        <option value="Spa & Wellness">Spa & Wellness</option>
                        <option value="Barbershop">Barbershop</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">
                        Business phone
                      </label>
                      <input
                        type="text"
                        value={formData.businessPhone}
                        onChange={(e) =>
                          setFormData({ ...formData, businessPhone: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                      />
                    </div>
                  </div>

                  {/* Currency & Language */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">
                        Currency
                      </label>
                      <input
                        type="text"
                        disabled
                        value={formData.currency}
                        className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-slate-400"
                      />
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">
                        Branch language setting
                      </label>
                      <select
                        value={formData.branchLanguage}
                        onChange={(e) =>
                          setFormData({ ...formData, branchLanguage: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
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
                    <label className="font-semibold text-slate-700 block mb-1">
                      Time zone
                    </label>
                    <select
                      value={formData.timeZone}
                      onChange={(e) =>
                        setFormData({ ...formData, timeZone: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
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
                <div className="lg:col-span-4 space-y-2 text-xs">
                  <label className="font-semibold text-slate-700 block">
                    Company logo
                  </label>
                  <div className="w-40 h-40 rounded-2xl bg-slate-100 border-2 border-dashed border-slate-300 flex flex-col items-center justify-center p-4 hover:border-[#5551FF] transition-colors cursor-pointer text-slate-400 hover:text-slate-600">
                    <Camera className="w-8 h-8 mb-2 opacity-60" />
                    <span className="text-[11px] text-center font-medium">
                      Upload logo
                    </span>
                  </div>
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
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2.5 border-b border-slate-100"
                  >
                    {/* Day & Open/Closed Switch */}
                    <div className="flex items-center gap-4 w-40">
                      <span className="font-bold text-slate-800 w-24">
                        {item.day}
                      </span>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.isOpen}
                          onChange={() => handleToggleDay(index)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#5551FF]" />
                        <span className="text-xs font-semibold text-slate-600">
                          {item.isOpen ? 'Open' : 'Closed'}
                        </span>
                      </label>
                    </div>

                    {/* From - To Hours */}
                    {item.isOpen ? (
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">From</span>
                        <select
                          value={item.from}
                          onChange={(e) =>
                            handleTimeChange(index, 'from', e.target.value)
                          }
                          className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                        >
                          <option>08:00</option>
                          <option>09:00</option>
                          <option>10:00</option>
                        </select>

                        <span className="text-slate-400">To</span>
                        <select
                          value={item.to}
                          onChange={(e) =>
                            handleTimeChange(index, 'to', e.target.value)
                          }
                          className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                        >
                          <option>17:00</option>
                          <option>18:00</option>
                          <option>19:00</option>
                          <option>20:00</option>
                        </select>

                        <button className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg">
                          <Plus className="w-4 h-4" />
                        </button>
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
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">
                  Closed Dates
                </h2>

                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-slate-100 p-1 rounded-xl text-xs font-semibold">
                    <button
                      onClick={() => setClosedDatesTab('closed')}
                      className={`px-3 py-1 rounded-lg transition-colors ${
                        closedDatesTab === 'closed'
                          ? 'bg-[#5551FF] text-white shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      Closed Dates
                    </button>
                    <button
                      onClick={() => setClosedDatesTab('absences')}
                      className={`px-3 py-1 rounded-lg transition-colors ${
                        closedDatesTab === 'absences'
                          ? 'bg-[#5551FF] text-white shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      Absences
                    </button>
                  </div>

                  <button className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs">
                    Import Holidays
                  </button>
                </div>
              </div>

              {/* Closed Dates list matching Figma Page 23, 37 */}
              <div className="py-8 text-center space-y-4">
                <p className="text-xs text-slate-400">No records found</p>

                <div className="flex justify-center gap-3">
                  <button
                    onClick={() =>
                      setClosedDatesList([
                        ...closedDatesList,
                        'Christmas Holiday (24 Dec - 26 Dec)',
                      ])
                    }
                    className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#5551FF] bg-[#5551FF]/8 hover:bg-[#5551FF]/15 rounded-xl transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>

                  <button className="px-3.5 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-600">
                    Load more
                  </button>
                </div>

                {closedDatesList.length > 0 && (
                  <div className="mt-4 max-w-sm mx-auto space-y-2">
                    {closedDatesList.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-center justify-between"
                      >
                        <span>{item}</span>
                        <Trash2
                          className="w-3.5 h-3.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                          onClick={() =>
                            setClosedDatesList(
                              closedDatesList.filter((_, i) => i !== idx)
                            )
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
                  <label className="font-semibold text-slate-700 block mb-1">
                    Company Description
                  </label>
                  <textarea
                    rows={3}
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    placeholder="Tell customers about your salon..."
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Link to your website
                  </label>
                  <input
                    type="url"
                    value={formData.website}
                    onChange={(e) =>
                      setFormData({ ...formData, website: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Link to your Facebook profile
                  </label>
                  <input
                    type="text"
                    value={formData.facebook}
                    onChange={(e) =>
                      setFormData({ ...formData, facebook: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Link to your X profile
                  </label>
                  <input
                    type="text"
                    value={formData.xProfile}
                    onChange={(e) =>
                      setFormData({ ...formData, xProfile: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Link to your Instagram profile
                  </label>
                  <input
                    type="text"
                    value={formData.instagram}
                    onChange={(e) =>
                      setFormData({ ...formData, instagram: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Link to your legal note
                  </label>
                  <input
                    type="url"
                    value={formData.legalNote}
                    onChange={(e) =>
                      setFormData({ ...formData, legalNote: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  />
                </div>

                <div className="pt-2">
                  <label className="flex items-center gap-3 cursor-pointer">
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
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#5551FF]" />
                    <span className="text-xs font-semibold text-slate-700">
                      Define custom terms & conditions and data privacy text for the booking page
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
