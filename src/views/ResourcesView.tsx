import React, { useEffect, useRef, useState } from 'react';
import { Plus, X, Check, Trash2 } from 'lucide-react';
import { IsometricCube } from '../components/IsometricCube';
import { Resource } from '../types';

interface ResourcesViewProps {
  resources: Resource[];
  onAddResource: (resource: Omit<Resource, 'id'>) => void;
  onUpdateResource: (id: string, resource: Partial<Resource>) => void;
  onDeleteResource: (id: string) => void;
}

export const ResourcesView: React.FC<ResourcesViewProps> = ({
  resources,
  onAddResource,
  onUpdateResource,
  onDeleteResource,
}) => {
  const [showModal, setShowModal] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [formError, setFormError] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<Resource['type']>('Room');
  const [capacity, setCapacity] = useState(1);
  const [selectedColor, setSelectedColor] = useState('#FDE047'); // yellow default
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!showModal) return;
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>('#resource-name')?.focus();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [showModal]);

  const colorPalette = [
    { name: 'Yellow', hex: '#FDE047' },
    { name: 'Coral', hex: '#F87171' },
    { name: 'Peach', hex: '#FDBA74' },
    { name: 'Mint', hex: '#86EFAC' },
    { name: 'Sky', hex: '#93C5FD' },
    { name: 'Lavender', hex: '#C4B5FD' },
    { name: 'Purple', hex: '#A78BFA' },
    { name: 'Teal', hex: '#5EEAD4' },
  ];

  const openEditor = (resource: Resource | null = null) => {
    setEditingResource(resource); setName(resource?.name ?? ''); setType(resource?.type ?? 'Room');
    setCapacity(resource?.capacity ?? 1); setSelectedColor(resource?.color ?? '#FDE047');
    setFormError(''); setShowModal(true);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setFormError('Enter a resource name.'); return; }
    if (!Number.isInteger(Number(capacity)) || Number(capacity) < 1) { setFormError('Capacity must be a whole number of at least 1.'); return; }

    const details: Omit<Resource, 'id'> = {
      name: name.trim(),
      type,
      capacity: Number(capacity),
      color: selectedColor,
      reserveEntireRoom: false,
      visibleOnline: false,
      allServices: false,
      generalHours: false,
    };
    if (editingResource) onUpdateResource(editingResource.id, details);
    else onAddResource(details);

    setName('');
    setShowModal(false);
  };

  return (
    <div className="min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          Resources
        </h1>

        <button
          onClick={() => openEditor()}
          className="flex min-h-11 items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Resource</span>
        </button>
      </div>
      <p className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900">Resources are an inventory-only demo. You can record and edit rooms, chairs and equipment. Capacity and resource availability do not control bookings, and resources are not shown on the customer booking page.</p>

      {/* Content: Empty State vs Resource Cards */}
      {resources.length === 0 ? (
        /* Empty state matching Figma Page 15, 29 */
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-16 text-center shadow-xs flex flex-col items-center justify-center space-y-5">
          <div className="max-w-full"><IsometricCube size={220} /></div>

          <div className="space-y-1.5">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900">
              You don’t have any resources
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Here you can add rooms, tables or rentals
            </p>
          </div>

          <div className="pt-2">
            <button
              onClick={() => openEditor()}
              className="min-h-11 px-5 py-2.5 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors"
            >
              New Resource
            </button>
          </div>
        </div>
      ) : (
        /* Populated State */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {resources.map((res) => (
            <div
              key={res.id}
              className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-4 relative group"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className="w-4 h-4 shrink-0 rounded-full ring-2 ring-white shadow-xs"
                    style={{ backgroundColor: res.color }}
                  />
                  <button onClick={() => openEditor(res)} aria-label={`Edit ${res.name}`} title="Edit resource" className="min-h-11 text-left font-bold text-sm text-slate-900 [overflow-wrap:anywhere] hover:underline">{res.name}</button>
                </div>
                <button
                  onClick={() => onDeleteResource(res.id)}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-slate-500 hover:text-rose-500 hover:bg-rose-50 rounded-lg focus-visible:outline-2 focus-visible:outline-[#5551FF]"
                  aria-label={`Delete ${res.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="text-xs text-slate-500 space-y-1">
                <p>Type: <strong className="text-slate-700">{res.type}</strong></p>
                <p>Capacity: <strong className="text-slate-700">{res.capacity} people</strong></p>
                <p>Inventory record · booking automation unavailable</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Slide-over / Modal for New Resource matching Figma Page 18, 32 */}
      {showModal && (
        <dialog ref={dialogRef} aria-labelledby="resource-dialog-title" onCancel={(event) => { event.preventDefault(); setShowModal(false); }} className="fixed inset-y-0 right-0 left-auto m-0 ml-auto h-dvh max-h-dvh w-full max-w-md overflow-y-auto overscroll-contain border-0 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-xs">
          <div className="min-h-full p-6 sm:p-7 space-y-5 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 id="resource-dialog-title" className="text-base font-bold text-slate-900">{editingResource ? 'Edit Resource' : 'New Resource'}</h2>
              <button
                onClick={() => setShowModal(false)}
                aria-label="Close resource editor"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form Fields matching Figma */}
            <form onSubmit={handleCreate} className="space-y-4 text-xs flex-1">
              <div>
                <label htmlFor="resource-name" className="font-semibold text-slate-700 block mb-1">
                  * Name
                </label>
                <input
                  id="resource-name"
                  type="text"
                  required
                  placeholder="e.g. Table 4 or Chair 1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                />
              </div>

              <div>
                <label htmlFor="resource-type" className="font-semibold text-slate-700 block mb-1">
                  * Type
                </label>
                <select
                  id="resource-type"
                  value={type}
                  onChange={(e) => setType(e.target.value as Resource['type'])}
                  className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                >
                  <option value="Room">Room</option>
                  <option value="Chair">Chair</option>
                  <option value="Table">Table</option>
                  <option value="Equipment">Equipment</option>
                  <option value="Rental">Rental</option>
                </select>
              </div>

              <div>
                <label htmlFor="resource-capacity" className="font-semibold text-slate-700 block mb-1">
                  Number of people
                </label>
                <input
                  id="resource-capacity"
                  type="number"
                  required
                  min="1"
                  step="1"
                  value={capacity}
                  onChange={(e) => setCapacity(Number(e.target.value))}
                  className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden tabular-nums"
                />
              </div>

              {/* Color Picker Swatches */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1.5">
                  Display color
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {colorPalette.map((col) => (
                    <button
                      key={col.hex}
                      type="button"
                      onClick={() => setSelectedColor(col.hex)}
                      aria-label={`${col.name} display color`}
                      aria-pressed={selectedColor === col.hex}
                      className="w-11 h-11 rounded-lg flex items-center justify-center transition-transform hover:scale-105 shadow-2xs relative border border-slate-200/50 focus-visible:outline-2 focus-visible:outline-[#5551FF]"
                      style={{ backgroundColor: col.hex }}
                    >
                      {selectedColor === col.hex && (
                        <Check className="w-3.5 h-3.5 text-slate-900 stroke-[2.5]" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <fieldset disabled aria-describedby="resource-automation-note" className="space-y-3 rounded-xl bg-slate-50 p-4 text-slate-500">
                <legend className="font-semibold">Booking automation — unavailable in this demo</legend>
                <p id="resource-automation-note">These options are not connected to scheduling. The capacity above is for inventory reference only.</p>
                {['Reserve the entire room on first booking', 'Show in the customer booking page', 'Apply to all services', 'Use general booking hours'].map((label) => <label key={label} className="flex items-start gap-2"><input type="checkbox" checked={false} readOnly className="mt-0.5" /><span>{label}</span></label>)}
              </fieldset>
              {formError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-700">{formError}</p>}

              {/* Action Buttons */}
              <div className="pt-4 border-t border-slate-100 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="min-h-11 flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-11 flex-1 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl transition-colors shadow-xs"
                >
                  {editingResource ? 'Save Resource' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </dialog>
      )}
    </div>
  );
};
