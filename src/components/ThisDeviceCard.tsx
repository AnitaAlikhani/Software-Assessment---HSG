import { KeyRound, LogOut, MonitorSmartphone } from 'lucide-react';
import { OWNER_WAIT_TEXT, type LiveConnection } from '../liveWhatsApp';
import { SIGN_OUT_LABEL } from '../views/chatScreen';

export interface ThisDeviceFacts {
  /** Whether this browser holds an owner key. */
  signedIn: boolean;
  /** What the server said about it (src/liveWhatsApp.ts). */
  connection: LiveConnection;
  /** While the server makes this connection wait: its sentence on why and how long. */
  waitNotice?: string | null;
  onSignOut: () => void;
}

/** One sentence on what this browser can do with the live chats. It never shows the key. */
export function deviceState({ signedIn, connection, waitNotice }: Pick<ThisDeviceFacts, 'signedIn' | 'connection' | 'waitNotice'>): { title: string; text: string } {
  if (!signedIn) {
    return {
      title: 'Not signed in to the live chats',
      text: 'To sign in, open your owner link on this device. It is kept in this browser and removed from the address at once.',
    };
  }
  switch (connection) {
    case 'denied':
      return { title: 'Signed in with a link that no longer works', text: 'The server refused the owner link this browser holds. Sign out here, then open your latest owner link.' };
    case 'loading':
      return { title: 'Signed in to the live chats', text: 'Checking the connection to the live chats…' };
    case 'waiting':
      return { title: 'Signed in, the server asks to wait', text: waitNotice ?? OWNER_WAIT_TEXT };
    case 'reconnecting':
      return { title: 'Signed in to the live chats', text: 'The server cannot be reached right now. The live chats come back by themselves.' };
    case 'off':
      return { title: 'Signed in, without live chats here', text: 'This browser is signed in, but this copy of the site has no live chats.' };
    case 'live':
      return { title: 'Signed in to the live chats', text: 'Live chats from your customers arrive in Conversations on this device.' };
  }
}

/**
 * Settings › Online booking › "This device": whether this browser is signed in to the live chats,
 * and the way out. Signing out matters on a shared or borrowed computer, where the owner link
 * would otherwise stay in the browser.
 */
export function ThisDeviceCard({ signedIn, connection, waitNotice, onSignOut }: ThisDeviceFacts) {
  const { title, text } = deviceState({ signedIn, connection, waitNotice });
  return (
    <section aria-labelledby="this-device-title" className="space-y-3">
      <h3 id="this-device-title" className="text-sm font-bold text-slate-900">This device</h3>
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:flex-row sm:items-center">
        <span aria-hidden="true" className={`flex size-10 shrink-0 items-center justify-center rounded-full ${signedIn && connection !== 'denied' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
          {signedIn ? <MonitorSmartphone className="size-5" /> : <KeyRound className="size-5" />}
        </span>
        <div className="min-w-0 flex-1 text-sm" role="status">
          <p className="font-semibold text-slate-900">{title}</p>
          <p className="text-slate-600">{text}</p>
        </div>
        {signedIn && (
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]"
          >
            <LogOut className="size-4" aria-hidden="true" />
            {SIGN_OUT_LABEL}
          </button>
        )}
      </div>
    </section>
  );
}
