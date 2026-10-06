import React, { useState } from 'react';
import { X, CreditCard, Banknote, Smartphone, CheckCircle2 } from 'lucide-react';
import { ServiceItem, Customer } from '../types';

interface POSModalProps {
  isOpen: boolean;
  onClose: () => void;
  services: ServiceItem[];
  customers: Customer[];
  onCompleteSale: (amount: number, serviceName: string) => void;
}

export const POSModal: React.FC<POSModalProps> = ({
  isOpen,
  onClose,
  services,
  customers,
  onCompleteSale,
}) => {
  const [selectedServiceId, setSelectedServiceId] = useState(services[0]?.id || '');
  const [selectedCustomerId, setSelectedCustomerId] = useState(customers[0]?.id || '');
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'cash' | 'twint'>('card');
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const currentService = services.find((s) => s.id === selectedServiceId) || services[0];
  const total = currentService ? currentService.priceCHF : 0;

  const handlePay = () => {
    onCompleteSale(total, currentService.name);
    setSuccess(true);
    setTimeout(() => {
      setSuccess(false);
      onClose();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 animate-in zoom-in-95 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">
              Bella Checkout
            </span>
            <h3 className="text-base font-bold text-slate-900 mt-1">POS Cash Register</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {success ? (
          <div className="py-8 text-center space-y-2">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
            <h4 className="text-base font-bold text-slate-900">Payment Completed!</h4>
            <p className="text-xs text-slate-500">CHF {total.toFixed(2)} recorded to register</p>
          </div>
        ) : (
          <div className="space-y-4 text-xs">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Select Service</label>
              <select
                value={selectedServiceId}
                onChange={(e) => setSelectedServiceId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — CHF {s.priceCHF.toFixed(2)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Customer</label>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              >
                <option value="walkin">Walk-in Customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.phone})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1.5">Payment Method</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('card')}
                  className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 text-xs font-semibold ${
                    paymentMethod === 'card'
                      ? 'border-[#5551FF] bg-[#5551FF]/5 text-[#5551FF]'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Card</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('twint')}
                  className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 text-xs font-semibold ${
                    paymentMethod === 'twint'
                      ? 'border-[#5551FF] bg-[#5551FF]/5 text-[#5551FF]'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  <Smartphone className="w-4 h-4" />
                  <span>TWINT</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cash')}
                  className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 text-xs font-semibold ${
                    paymentMethod === 'cash'
                      ? 'border-[#5551FF] bg-[#5551FF]/5 text-[#5551FF]'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  <Banknote className="w-4 h-4" />
                  <span>Cash</span>
                </button>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
              <span className="font-bold text-slate-700">Total Due</span>
              <span className="text-base font-extrabold text-slate-900 tabular-nums">
                CHF {total.toFixed(2)}
              </span>
            </div>

            <button
              onClick={handlePay}
              className="w-full py-2.5 text-xs font-bold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors"
            >
              Charge CHF {total.toFixed(2)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
