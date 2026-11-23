import React, { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { researchMode } from '../flags';
import { clearDemoWorkspace } from '../researchTools';
import { salonOnServer, useSalonStatus } from '../useDemoState';

interface StudyToolsProps {
  /** Opens the pilot interest form. */
  onOpenPilotInterest: () => void;
  className?: string;
}

/**
 * The study tools of the menu, shown with the research switch only: the way to the pilot interest
 * form, the notice that this is a sample workspace, and the way back to its start (the reset for
 * presenters, between two participants). They stand at the end of the menu on laptops and of
 * "More" on phones. A normal visitor never gets them.
 */
export const StudyTools: React.FC<StudyToolsProps> = ({ onOpenPilotInterest, className = '' }) => {
  const research = researchMode();
  // On a device signed in with the owner's key the salon's settings live on the server: two
  // resets then, each saying what it resets. Without a key there is only this browser's.
  const onServer = useSalonStatus().phase === 'ready';
  const [sharedReset, setSharedReset] = useState<{ busy: boolean; result: string | null }>({ busy: false, result: null });
  if (!research) return null;
  const resetDemoData = () => {
    const question = onServer
      ? 'Reset the data in this browser? Appointments, requests, customers and the built-in chats go back to their starting state, in every open tab. The shared salon on the server stays as it is.'
      : 'Reset the demo data in this browser? Bookings, customers, chats and settings go back to their starting state, in every open tab.';
    if (!window.confirm(question)) return;
    clearDemoWorkspace();
    // Reload, so that this tab also forgets what its screens hold (an open form, a selected chat).
    window.location.reload();
  };
  const resetSharedSalon = async () => {
    const salon = salonOnServer();
    if (!salon || sharedReset.busy) return;
    if (!window.confirm('Reset the shared salon? Services, team, opening hours, closed dates, the salon details and the AI settings on the server go back to their starting values, on every signed-in device. Appointments and customers in this browser stay.')) return;
    setSharedReset({ busy: true, result: null });
    const problem = await salon.resetShared();
    setSharedReset({ busy: false, result: problem ?? 'The shared salon is back to its starting values.' });
  };
  const secondary = 'flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF] disabled:opacity-60';
  return (
    <div className={`space-y-2 ${className}`}>
      <button type="button" aria-haspopup="dialog" aria-controls="pilot-interest-dialog" onClick={onOpenPilotInterest}
        className="flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]">
        Register interest
      </button>
      {onServer ? (
        <>
          <p className="px-1 text-[11px] leading-relaxed text-slate-500">Demo workspace. The salon's settings are shared through the server; bookings, customers and chats are kept in this browser.</p>
          <button type="button" onClick={resetDemoData} className={secondary}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Reset this browser's data
          </button>
          <button type="button" onClick={() => void resetSharedSalon()} disabled={sharedReset.busy} className={secondary}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />{sharedReset.busy ? 'Resetting…' : 'Reset the shared salon'}
          </button>
          <p role="status" className="px-1 text-[11px] leading-relaxed text-slate-600">{sharedReset.result ?? ''}</p>
        </>
      ) : (
        <>
          <p className="px-1 text-[11px] leading-relaxed text-slate-500">Demo workspace with sample data. Changes are kept in this browser and show in all its tabs.</p>
          <button type="button" onClick={resetDemoData} className={secondary}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Reset demo data
          </button>
        </>
      )}
    </div>
  );
};
