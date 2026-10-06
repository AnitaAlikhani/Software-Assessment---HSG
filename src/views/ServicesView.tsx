import React, { useState } from 'react';
import {
  Plus,
  X,
  GripVertical,
  Trash2,
  Clock,
  Sparkles,
} from 'lucide-react';
import { ServiceItem } from '../types';

interface ServicesViewProps {
  services: ServiceItem[];
  onAddService: (srv: Omit<ServiceItem, 'id'>) => void;
  onUpdateService: (id: string, srv: Partial<ServiceItem>) => void;
  onDeleteService: (id: string) => void;
}

export const ServicesView: React.FC<ServicesViewProps> = ({
  services,
  onAddService,
  onUpdateService,
  onDeleteService,
}) => {
  const [editingService, setEditingService] = useState<ServiceItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form state matching Figma Page 20, 34
  const [name, setName] = useState('');
  const [showInBooking, setShowInBooking] = useState(true);
  const [category, setCategory] = useState('No category');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('45.00');
  const [duration, setDuration] = useState(30);
  const [prepTime, setPrepTime] = useState(0);
  const [postTime, setPostTime] = useState(0);

  const startEdit = (srv: ServiceItem) => {
    setEditingService(srv);
    setName(srv.name);
    setShowInBooking(srv.onlineBooking);
    setCategory(srv.category || 'No category');
    setDescription(srv.description || '');
    setPrice(srv.priceCHF.toFixed(2));
    setDuration(srv.durationMinutes);
    setPrepTime(srv.prepMinutes || 0);
    setPostTime(srv.postMinutes || 0);
    setIsCreating(false);
  };

  const startCreate = () => {
    setEditingService(null);
    setName('');
    setShowInBooking(true);
    setCategory('No category');
    setDescription('Add a description here to help your customers find the right service.');
    setPrice('50.00');
    setDuration(30);
    setPrepTime(0);
    setPostTime(0);
    setIsCreating(true);
  };

  const handleSaveModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (editingService) {
      onUpdateService(editingService.id, {
        name: name.trim(),
        priceCHF: parseFloat(price) || 0,
        durationMinutes: Number(duration) || 30,
        onlineBooking: showInBooking,
        category,
        description,
        prepMinutes: prepTime,
        postMinutes: postTime,
      });
      setEditingService(null);
    } else if (isCreating) {
      onAddService({
        name: name.trim(),
        priceCHF: parseFloat(price) || 0,
        durationMinutes: Number(duration) || 30,
        onlineBooking: showInBooking,
        assignedEmployeesCount: 1,
        category,
        description,
        prepMinutes: prepTime,
        postMinutes: postTime,
      });
      setIsCreating(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          Services
        </h1>

        <button
          onClick={startCreate}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Service</span>
        </button>
      </div>

      {/* Services Table matching Figma Page 17, 31 */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-x-auto">
        <div className="min-w-[760px]">
          {/* Header Row */}
          <div className="grid grid-cols-12 border-b border-slate-100 text-xs font-semibold text-slate-400 py-3.5 px-6 bg-slate-50/50">
            <div className="col-span-4">Name</div>
            <div className="col-span-2">Duration</div>
            <div className="col-span-2">Price</div>
            <div className="col-span-2 text-center">Online booking</div>
            <div className="col-span-2 text-right">Employees</div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-100">
            {services.map((srv) => (
              <div
                key={srv.id}
                onClick={() => startEdit(srv)}
                className="grid grid-cols-12 items-center py-4 px-6 hover:bg-slate-50/70 transition-colors text-xs text-slate-700 cursor-pointer group"
              >
                {/* Grip Handle + Name */}
                <div className="col-span-4 flex items-center gap-3">
                  <GripVertical className="w-4 h-4 text-slate-300 group-hover:text-slate-400 cursor-grab" />
                  <span className="font-semibold text-slate-900 truncate">
                    {srv.name}
                  </span>
                </div>

                {/* Duration */}
                <div className="col-span-2 text-slate-600 font-medium tabular-nums">
                  {srv.durationMinutes} min
                </div>

                {/* Price */}
                <div className="col-span-2 font-bold text-slate-900 tabular-nums">
                  CHF {srv.priceCHF.toFixed(2)}
                </div>

                {/* Online booking Switch */}
                <div
                  className="col-span-2 flex justify-center"
                  onClick={(e) => e.stopPropagation()}
                >
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={srv.onlineBooking}
                      onChange={(e) =>
                        onUpdateService(srv.id, { onlineBooking: e.target.checked })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#5551FF]" />
                  </label>
                </div>

                {/* Employees + Delete */}
                <div className="col-span-2 flex items-center justify-end gap-3 text-slate-500">
                  <span className="truncate">
                    {srv.assignedEmployeesCount}{' '}
                    {srv.assignedEmployeesCount === 1 ? 'employee' : 'employees'}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteService(srv.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 rounded-md transition-opacity"
                    aria-label={`Delete ${srv.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Edit / New Service Slide-Over Modal matching Figma Page 20, 34 */}
      {(editingService || isCreating) && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex justify-end">
          <form
            onSubmit={handleSaveModal}
            className="w-full max-w-lg bg-white h-full shadow-2xl p-6 sm:p-7 overflow-y-auto space-y-5 flex flex-col animate-in slide-in-from-right duration-200 text-xs"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-900">
                {isCreating ? 'Create Service' : 'Edit Service'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setEditingService(null);
                  setIsCreating(false);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Service Details Header & Show in Booking toggle */}
            <div className="flex items-center justify-between pt-1">
              <span className="font-bold text-slate-800 text-xs uppercase tracking-wider">
                Service Details
              </span>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-xs text-slate-500 font-medium">Show in booking</span>
                <input
                  type="checkbox"
                  checked={showInBooking}
                  onChange={(e) => setShowInBooking(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#5551FF]" />
              </label>
            </div>

            {/* Name */}
            <div>
              <label className="font-semibold text-slate-700 block mb-1">* Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
              />
            </div>

            {/* Category */}
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
              >
                <option value="No category">No category</option>
                <option value="Hair">Hair</option>
                <option value="Haircut">Haircut</option>
                <option value="Colour">Colour</option>
                <option value="Treatment">Treatment</option>
              </select>
            </div>

            {/* Description */}
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Description</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description here to help your customers find the right service."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden text-slate-600"
              />
            </div>

            {/* Price & Tax Type */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Price (CHF)</label>
                <input
                  type="number"
                  step="0.05"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden tabular-nums"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Tax Type</label>
                <select className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden text-slate-600">
                  <option>No tax information</option>
                  <option>Standard 8.1% (VAT)</option>
                  <option>Reduced 2.6%</option>
                </select>
              </div>
            </div>

            {/* Duration & Working step matching Figma */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-700">Duration</label>
                <span className="font-bold text-[#5551FF] tabular-nums">{duration} min</span>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                <span className="font-semibold text-slate-700">Work · {name || 'Sample Service'}</span>
                <span className="text-slate-500 tabular-nums">{duration} min</span>
              </div>

              <button
                type="button"
                className="text-[#5551FF] font-semibold text-xs flex items-center gap-1 mt-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add working step</span>
              </button>
            </div>

            {/* Preparation time & Post-processing time */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Preparation time
                </label>
                <select
                  value={prepTime}
                  onChange={(e) => setPrepTime(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden"
                >
                  <option value={0}>0 min</option>
                  <option value={5}>5 min</option>
                  <option value={10}>10 min</option>
                  <option value={15}>15 min</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Post-processing time
                </label>
                <select
                  value={postTime}
                  onChange={(e) => setPostTime(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden"
                >
                  <option value={0}>0 min</option>
                  <option value={5}>5 min</option>
                  <option value={10}>10 min</option>
                  <option value={15}>15 min</option>
                </select>
              </div>
            </div>

            {/* Employees Assignment */}
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 block">Employees</label>
              <div className="p-2 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#5551FF]/10 text-[#5551FF] font-semibold text-xs">
                  Nilufar Ismayilova
                  <X className="w-3 h-3 cursor-pointer" />
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="pt-4 border-t border-slate-100 flex gap-2 mt-auto">
              <button
                type="button"
                onClick={() => {
                  setEditingService(null);
                  setIsCreating(false);
                }}
                className="flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl transition-colors shadow-xs"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
