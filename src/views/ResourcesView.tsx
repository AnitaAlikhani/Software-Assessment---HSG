import React, { useState } from 'react';
import { Plus, X, Check, Box, Trash2, Users } from 'lucide-react';
import { IsometricCube } from '../components/IsometricCube';
import { Resource } from '../types';

interface ResourcesViewProps {
  resources: Resource[];
  onAddResource: (resource: Omit<Resource, 'id'>) => void;
  onDeleteResource: (id: string) => void;
}

export const ResourcesView: React.FC<ResourcesViewProps> = ({
  resources,
  onAddResource,
  onDeleteResource,
}) => {
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<Resource['type']>('Room');
  const [capacity, setCapacity] = useState(1);
  const [selectedColor, setSelectedColor] = useState('#FDE047'); // yellow default
  const [reserveEntireRoom, setReserveEntireRoom] = useState(false);
  const [visibleOnline, setVisibleOnline] = useState(false);
  const [allServices, setAllServices] = useState(true);
  const [generalHours, setGeneralHours] = useState(true);

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

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onAddResource({
      name: name.trim(),
      type,
      capacity: Number(capacity) || 1,
      color: selectedColor,
      reserveEntireRoom,
      visibleOnline,
      allServices,
      generalHours,
    });

    setName('');
    setShowModal(false);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          Resources
        </h1>

        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Resource</span>
        </button>
      </div>

      {/* Content: Empty State vs Resource Cards */}
      {resources.length === 0 ? (
        /* Empty state matching Figma Page 15, 29 */
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 sm:p-16 text-center shadow-xs flex flex-col items-center justify-center space-y-5">
          <IsometricCube size={220} />

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
              onClick={() => setShowModal(true)}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors"
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
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-4 h-4 rounded-full ring-2 ring-white shadow-xs"
                    style={{ backgroundColor: res.color }}
                  />
                  <span className="font-bold text-sm text-slate-900">{res.name}</span>
                </div>
                <button
                  onClick={() => onDeleteResource(res.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 rounded-lg transition-opacity"
                  aria-label={`Delete ${res.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="text-xs text-slate-500 space-y-1">
                <p>Type: <strong className="text-slate-700">{res.type}</strong></p>
                <p>Capacity: <strong className="text-slate-700">{res.capacity} people</strong></p>
                <p>Visible in booking widget: <strong className="text-slate-700">{res.visibleOnline ? 'Yes' : 'No'}</strong></p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Slide-over / Modal for New Resource matching Figma Page 18, 32 */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-md bg-white h-full shadow-2xl p-6 sm:p-7 overflow-y-auto space-y-5 flex flex-col animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-900">New Resource</h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form Fields matching Figma */}
            <form onSubmit={handleCreate} className="space-y-4 text-xs flex-1">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  * Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Table 4 or Chair 1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  * Type
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                >
                  <option value="Room">Room</option>
                  <option value="Chair">Chair</option>
                  <option value="Table">Table</option>
                  <option value="Equipment">Equipment</option>
                  <option value="Rental">Rental</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Number of people
                </label>
                <input
                  type="number"
                  min="1"
                  value={capacity}
                  onChange={(e) => setCapacity(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden tabular-nums"
                />
              </div>

              {/* Color Picker Swatches */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1.5">
                  * Appointment color
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {colorPalette.map((col) => (
                    <button
                      key={col.hex}
                      type="button"
                      onClick={() => setSelectedColor(col.hex)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center transition-transform hover:scale-110 shadow-2xs relative border border-slate-200/50"
                      style={{ backgroundColor: col.hex }}
                    >
                      {selectedColor === col.hex && (
                        <Check className="w-3.5 h-3.5 text-slate-900 stroke-[2.5]" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Checkboxes from Figma */}
              <div className="space-y-3 pt-2 text-slate-600">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={reserveEntireRoom}
                    onChange={(e) => setReserveEntireRoom(e.target.checked)}
                    className="rounded text-[#5551FF] focus:ring-[#5551FF] mt-0.5"
                  />
                  <span>First booking reserves entire room</span>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={visibleOnline}
                    onChange={(e) => setVisibleOnline(e.target.checked)}
                    className="rounded text-[#5551FF] focus:ring-[#5551FF] mt-0.5"
                  />
                  <span>
                    Your customers can choose this resource in the booking widget (visible online)
                  </span>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allServices}
                    onChange={(e) => setAllServices(e.target.checked)}
                    className="rounded text-[#5551FF] focus:ring-[#5551FF] mt-0.5"
                  />
                  <span>Can be booked for all services</span>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={generalHours}
                    onChange={(e) => setGeneralHours(e.target.checked)}
                    className="rounded text-[#5551FF] focus:ring-[#5551FF] mt-0.5"
                  />
                  <span>Bookable during general booking hours</span>
                </label>
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-slate-100 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl transition-colors shadow-xs"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
