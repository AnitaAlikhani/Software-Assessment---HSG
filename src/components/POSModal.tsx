import React, { useEffect, useRef, useState } from 'react';
import { X, CreditCard, Banknote, Smartphone, CheckCircle2 } from 'lucide-react';
import { ServiceItem, Customer } from '../types';

interface POSModalProps {
  isOpen: boolean;
  onClose: () => void;
  services: ServiceItem[];
  customers: Customer[];
  onCompleteSale: (amount: number, serviceName: string) => void;
}

type PaymentMethod = 'card' | 'cash' | 'twint';
const paymentMethods = [
  { value: 'card' as const, label: 'Card', Icon: CreditCard },
  { value: 'twint' as const, label: 'TWINT', Icon: Smartphone },
  { value: 'cash' as const, label: 'Cash', Icon: Banknote },
];

export const POSModal: React.FC<POSModalProps> = ({
  isOpen,
  onClose,
  services,
  customers,
  onCompleteSale,
}) => {
  const [selectedServiceId, setSelectedServiceId] = useState(services[0]?.id ?? '');
  const [selectedCustomerId, setSelectedCustomerId] = useState(customers[0]?.id ?? 'walkin');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');
  const [completedSale, setCompletedSale] = useState<{ amount: number; serviceName: string; customerName: string; paymentLabel: string } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);

  const currentService = services.find((service) => service.id === selectedServiceId) ?? services[0];
  const currentCustomerId = customers.some((customer) => customer.id === selectedCustomerId) ? selectedCustomerId : 'walkin';
  const total = currentService?.priceCHF ?? 0;
  const canPay = Boolean(currentService) && Number.isFinite(total) && total >= 0;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen) {
      if (dialog.open) dialog.close();
      setCompletedSale(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isOpen]);

  useEffect(() => {
    if (completedSale) doneRef.current?.focus();
  }, [completedSale]);

  const handlePay = (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentService || !canPay || completedSale) return;
    setCompletedSale({
      amount: total,
      serviceName: currentService.name,
      customerName: customers.find(customer => customer.id === currentCustomerId)?.name ?? 'Walk-in customer',
      paymentLabel: paymentMethods.find((method) => method.value === paymentMethod)!.label,
    });
    onCompleteSale(total, currentService.name);
  };

  return (
    <dialog
      ref={dialogRef}
      id="pos-checkout-dialog"
      aria-labelledby="pos-checkout-title"
      aria-describedby="pos-checkout-description"
      onClose={onClose}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-xs"
    >
      <div className="p-6 space-y-5">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">Demo checkout</span>
            <h2 id="pos-checkout-title" className="text-base font-bold text-slate-900 mt-2">POS Cash Register</h2>
            <p id="pos-checkout-description" className="text-xs text-slate-500 mt-1.5 leading-relaxed">Try a simulated payment. No real payment will be taken.</p>
          </div>
          <button type="button" autoFocus onClick={onClose} aria-label="Close demo checkout" className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[#5551FF]">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {completedSale ? (
          <div className="text-center space-y-4 py-3">
            <div role="status" className="space-y-2">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" aria-hidden="true" />
              <h3 className="text-base font-bold text-slate-900">Simulated payment complete</h3>
              <p className="text-xs text-slate-600">CHF {completedSale.amount.toFixed(2)} for {completedSale.serviceName} using {completedSale.paymentLabel}.</p>
              <p className="text-xs text-slate-600">Customer: {completedSale.customerName}</p>
              <p className="text-xs text-slate-500">No money was charged or recorded as a real sale.</p>
            </div>
            <button ref={doneRef} type="button" onClick={onClose} className="w-full py-2.5 text-xs font-bold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]">Done</button>
          </div>
        ) : (
          <form onSubmit={handlePay} className="space-y-4 text-xs">
            <div>
              <label htmlFor="pos-service" className="font-semibold text-slate-700 block mb-1">Select service</label>
              <select id="pos-service" value={currentService?.id ?? ''} onChange={(event) => setSelectedServiceId(event.target.value)} disabled={!currentService} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl disabled:text-slate-400">
                {services.length === 0 && <option value="">No services available</option>}
                {services.map((service) => <option key={service.id} value={service.id}>{service.name} · CHF {service.priceCHF.toFixed(2)}</option>)}
              </select>
              {!currentService && <p role="status" className="mt-2 text-slate-500">Add a service in Services before trying checkout.</p>}
              {currentService && !canPay && <p role="alert" className="mt-2 text-rose-600">Choose a service with a valid price before trying checkout.</p>}
            </div>

            <div>
              <label htmlFor="pos-customer" className="font-semibold text-slate-700 block mb-1">Customer</label>
              <select id="pos-customer" value={currentCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                <option value="walkin">Walk-in customer</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} ({customer.phone})</option>)}
              </select>
            </div>

            <fieldset>
              <legend className="font-semibold text-slate-700 mb-1.5">Payment method</legend>
              <div className="grid grid-cols-3 gap-2">
                {paymentMethods.map(({ value, label, Icon }) => (
                  <button key={value} type="button" aria-pressed={paymentMethod === value} onClick={() => setPaymentMethod(value)} className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF] ${paymentMethod === value ? 'border-[#5551FF] bg-[#5551FF]/5 text-[#5551FF]' : 'border-slate-200 text-slate-600'}`}>
                    <Icon className="w-4 h-4" aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
              <span className="font-bold text-slate-700">Demo total</span>
              <span className="text-base font-extrabold text-slate-900 tabular-nums">CHF {canPay ? total.toFixed(2) : '0.00'}</span>
            </div>
            <button type="submit" disabled={!canPay} className="w-full py-2.5 text-xs font-bold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]">
              {canPay ? `Simulate payment of CHF ${total.toFixed(2)}` : 'Simulate payment'}
            </button>
          </form>
        )}
      </div>
    </dialog>
  );
};
