import React, { useState } from 'react';
import {
  Scissors,
  User,
  Calendar as CalendarIcon,
  Clock,
  Sparkles,
  CheckCircle2,
  Share2,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { ServiceItem, Employee, AppointmentRequest } from '../types';

interface BookingPageViewProps {
  services: ServiceItem[];
  employees: Employee[];
  onNewBookingRequest: (req: AppointmentRequest) => void;
}

export const BookingPageView: React.FC<BookingPageViewProps> = ({
  services,
  employees,
  onNewBookingRequest,
}) => {
  const [selectedService, setSelectedService] = useState<ServiceItem>(services[0]);
  const [selectedStaff, setSelectedStaff] = useState<string>('Nilufar Ismayilova');
  const [selectedDate, setSelectedDate] = useState('2026-10-01');
  const [selectedTime, setSelectedTime] = useState('10:00 - 10:30');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [channel, setChannel] = useState<'WhatsApp' | 'Instagram' | 'Web'>('WhatsApp');
  const [isSuccess, setIsSuccess] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const availableSlots = [
    '09:00 - 09:30',
    '10:00 - 10:30',
    '11:00 - 11:30',
    '13:30 - 14:00',
    '14:30 - 15:00',
    '16:00 - 16:30',
  ];

  const handleBookingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim()) return;

    const newRequest: AppointmentRequest = {
      id: `req-${Date.now()}`,
      customerName: clientName.trim(),
      serviceName: selectedService.name,
      dateStr: '1 October 2026',
      timeStr: selectedTime,
      timeAgo: 'Just now',
      staffName: selectedStaff,
      channel,
      status: 'pending',
    };

    onNewBookingRequest(newRequest);
    setIsSuccess(true);
  };

  const handleCopy = () => {
    navigator.clipboard?.writeText('https://bellahair.ch/book');
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6 animate-in fade-in duration-200">
      {/* Top Banner with shareable link */}
      <div className="bg-gradient-to-r from-[#5551FF] to-indigo-600 rounded-2xl p-6 text-white shadow-lg shadow-indigo-500/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs uppercase font-bold tracking-widest text-indigo-200">
            Public Booking Page Preview
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight mt-0.5">
            Your Online Booking Widget
          </h1>
          <p className="text-xs sm:text-sm text-indigo-100 max-w-lg mt-1">
            This is the live booking flow clients see when visiting your booking link or booking via WhatsApp & Instagram.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-white/15 backdrop-blur-md px-3.5 py-2 rounded-xl border border-white/20 self-stretch sm:self-auto justify-between">
          <span className="text-xs font-mono text-indigo-100">bellahair.ch/book</span>
          <button
            onClick={handleCopy}
            className="p-1 hover:bg-white/20 rounded-md transition-colors text-white"
            title="Copy booking link"
            aria-label="Copy booking link"
          >
            {copiedLink ? <CheckCircle2 className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Booking Form Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-xs">
        {isSuccess ? (
          <div className="text-center py-10 space-y-4 animate-in zoom-in-95">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">
              Booking Request Received!
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
              Your appointment request for <strong>{selectedService.name}</strong> on{' '}
              <strong>1 October 2026 ({selectedTime})</strong> with{' '}
              <strong>{selectedStaff}</strong> has been sent to the salon manager.
            </p>
            <div className="p-4 bg-indigo-50/70 border border-indigo-100 rounded-xl text-xs text-indigo-900 max-w-sm mx-auto">
              ✨ <strong>Tip:</strong> Head over to the <strong>Dashboard Home</strong> to review, accept, or reschedule this incoming request!
            </div>
            <button
              onClick={() => {
                setIsSuccess(false);
                setClientName('');
              }}
              className="px-6 py-2.5 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl transition-colors"
            >
              Book Another Appointment
            </button>
          </div>
        ) : (
          <form onSubmit={handleBookingSubmit} className="space-y-6">
            {/* Salon Header Branding */}
            <div className="flex items-center gap-3 pb-5 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-[#5551FF] text-white flex items-center justify-center font-bold text-base shadow-xs">
                B
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Bella Hair Salon</h2>
                <p className="text-xs text-slate-400">Musterstrasse 1, 9000 St. Gallen, Switzerland</p>
              </div>
            </div>

            {/* Step 1: Select Service */}
            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
                1. Select Service
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {services
                  .filter((s) => s.onlineBooking)
                  .map((srv) => (
                    <div
                      key={srv.id}
                      onClick={() => setSelectedService(srv)}
                      className={`p-4 rounded-xl border cursor-pointer transition-all ${
                        selectedService.id === srv.id
                          ? 'border-[#5551FF] bg-[#5551FF]/5 ring-1 ring-[#5551FF]'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-slate-900">{srv.name}</span>
                        <span className="font-bold text-xs text-[#5551FF]">
                          CHF {srv.priceCHF.toFixed(2)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{srv.durationMinutes} minutes</p>
                    </div>
                  ))}
              </div>
            </div>

            {/* Step 2: Choose Stylist */}
            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
                2. Select Specialist
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {employees.map((emp) => (
                  <div
                    key={emp.id}
                    onClick={() => setSelectedStaff(emp.name)}
                    className={`p-3.5 rounded-xl border cursor-pointer flex items-center gap-3 transition-all ${
                      selectedStaff === emp.name
                        ? 'border-[#5551FF] bg-[#5551FF]/5 ring-1 ring-[#5551FF]'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-xl bg-purple-50 text-[#5551FF] font-bold text-xs flex items-center justify-center">
                      {emp.initials}
                    </div>
                    <div>
                      <p className="font-bold text-xs text-slate-800">{emp.name}</p>
                      <p className="text-[11px] text-slate-400">Senior Stylist · Available</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Step 3: Date & Time */}
            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
                3. Choose Time Slot (Thursday, 1 Oct 2026)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {availableSlots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setSelectedTime(slot)}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold tabular-nums border transition-all ${
                      selectedTime === slot
                        ? 'bg-[#5551FF] text-white border-[#5551FF] shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            </div>

            {/* Step 4: Client Info */}
            <div className="space-y-3 pt-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
                4. Your Contact Information
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Your Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Sandra Meier"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    placeholder="+41 79 123 45 67"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Booking via Channel
                </label>
                <div className="flex gap-3">
                  {(['WhatsApp', 'Instagram', 'Web'] as const).map((ch) => (
                    <label key={ch} className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        name="channel"
                        checked={channel === ch}
                        onChange={() => setChannel(ch)}
                        className="text-[#5551FF] focus:ring-[#5551FF]"
                      />
                      <span>{ch}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-4 border-t border-slate-100">
              <button
                type="submit"
                className="w-full py-3 text-xs sm:text-sm font-bold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-md shadow-indigo-500/20 transition-all flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>Confirm & Request Appointment</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
