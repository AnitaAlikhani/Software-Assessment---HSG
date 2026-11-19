import React from 'react';
import { RotateCcw } from 'lucide-react';
import { researchMode } from '../flags';
import { browserStorages, clearDemoWorkspace } from '../researchTools';

interface StudyToolsProps {
  /** Opens the pilot interest form. */
  onOpenPilotInterest: () => void;
  className?: string;
}

/**
 * The study tools of the menu, shown with the research switch only: the way to the pilot interest
 * form, the notice that this is a sample workspace, and the way back to its start. They stand at
 * the end of the menu on laptops and of "More" on phones. A normal visitor never gets them.
 */
export const StudyTools: React.FC<StudyToolsProps> = ({ onOpenPilotInterest, className = '' }) => {
  if (!researchMode()) return null;
  const resetDemoData = () => {
    if (!window.confirm('Reset the demo data in this browser? Bookings, customers and chats go back to their starting state.')) return;
    clearDemoWorkspace(browserStorages());
    // Reload at once, before any state is written back to storage.
    window.location.reload();
  };
  return (
    <div className={`space-y-2 ${className}`}>
      <button type="button" aria-haspopup="dialog" aria-controls="pilot-interest-dialog" onClick={onOpenPilotInterest}
        className="flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]">
        Register interest
      </button>
      <p className="px-1 text-[11px] leading-relaxed text-slate-500">Demo workspace with sample data. Changes stay in this browser tab.</p>
      <button type="button" onClick={resetDemoData}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]">
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Reset demo data
      </button>
    </div>
  );
};
