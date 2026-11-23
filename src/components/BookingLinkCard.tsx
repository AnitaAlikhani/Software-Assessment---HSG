import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { CheckCircle2, Copy, Download, ExternalLink, Link2, Printer, QrCode as QrCodeIcon } from 'lucide-react';
import { bookingAddress, qrFileName, qrModules, qrPath, qrSide, QR_QUIET_ZONE } from '../bookingLink';
import { researchMode } from '../flags';
import { useSalonStatus } from '../useDemoState';

/**
 * The booking link: what the owner needs of the customers' booking page. Not the form itself
 * (customers fill that in), but its address to pass on: copy it, open it the way a customer
 * does, or hand out its QR code on a card, a mirror sticker or the door.
 *
 * BookingLinkCard is the full card in Settings › Online booking. BookingLinkCompact is the
 * short form for Home: the address, Copy and the code on request. BookingLinkButtons is the same
 * as two buttons, for the heading row of Home on a wide screen.
 */

interface BookingLinkProps {
  /** The address customers book at. Left out, it is this site's own (see bookingAddress). */
  address?: string;
  className?: string;
}

const useBookingAddress = (address?: string): string =>
  // No browser while a test draws the card: then the address has to be given.
  address ?? (typeof window === 'undefined' ? '' : bookingAddress(window.location));

/** Copies the address and says for a moment that it did, or that it could not. */
function useCopyLink(address: string) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const copy = async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(address);
      setCopyState('copied');
      // "Copied" answers one tap. It must not stay as if the button were a switch.
      timer.current = window.setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('failed');
    }
  };
  return { copyState, copy };
}

/** What Copy did. Success shows on the button itself and is read out; a failure says what to do instead. */
const CopyFeedback: React.FC<{ state: 'idle' | 'copied' | 'failed' }> = ({ state }) => (
  <>
    {/* Always in the page, so a screen reader announces the text when it appears. */}
    <span role="status" className="sr-only">{state === 'copied' ? 'Booking link copied.' : ''}</span>
    {state === 'failed' && <p role="alert" className="text-xs text-rose-700">The link could not be copied. Select it and copy it by hand.</p>}
  </>
);

interface QrCodeProps {
  address: string;
  className?: string;
}

/** The QR code of the booking link, drawn as vector shapes: sharp at any size, on screen and on paper. */
export const BookingQrCode: React.FC<QrCodeProps> = ({ address, className = '' }) => {
  const modules = useMemo(() => qrModules(address), [address]);
  const side = qrSide(modules);
  return (
    <svg role="img" aria-label="QR code of the booking link" viewBox={`0 0 ${side} ${side}`} shapeRendering="crispEdges" className={className}>
      <rect width={side} height={side} fill="#ffffff" />
      <path d={qrPath(modules)} fill="#000000" />
    </svg>
  );
};

/** The code as a PNG picture of about `pixels` a side, drawn in the browser. Null if the browser cannot. */
function qrPicture(address: string, pixels = 1024): Promise<Blob | null> {
  const modules = qrModules(address);
  const scale = Math.max(1, Math.floor(pixels / qrSide(modules)));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = qrSide(modules) * scale;
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000';
  modules.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) context.fillRect((x + QR_QUIET_ZONE) * scale, (y + QR_QUIET_ZONE) * scale, scale, scale);
  }));
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * How the printed sheet looks. On screen it is not shown at all; on paper it is the only thing:
 * the app (#root) is left off while the sheet is in the page.
 */
const SHEET_STYLE = `
@media screen { .booking-link-sheet { display: none; } }
@media print {
  #root { display: none !important; }
  .booking-link-sheet { padding: 18mm 12mm; text-align: center; color: #000; }
  .booking-link-sheet-salon { font-size: 28pt; font-weight: 800; }
  .booking-link-sheet-line { margin: 6mm 0 10mm; font-size: 16pt; }
  .booking-link-sheet-code { display: block; width: 90mm; height: 90mm; margin: 0 auto; }
  .booking-link-sheet-address { margin-top: 10mm; font-size: 11pt; overflow-wrap: anywhere; }
}`;

const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]';
const quietButton = `${buttonClass} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;

interface BookingLinkCardProps extends BookingLinkProps {
  /** The salon's name: on the printed sheet and in the name of the saved picture. */
  salonName?: string;
}

export const BookingLinkCard: React.FC<BookingLinkCardProps> = ({ address: given, salonName = '', className = '' }) => {
  // A signed-in device: the study hint says what the server holds and what this browser still keeps.
  const onServer = useSalonStatus().phase === 'ready';
  const address = useBookingAddress(given);
  const { copyState, copy } = useCopyLink(address);
  const [pictureError, setPictureError] = useState(false);
  const [printing, setPrinting] = useState(false);
  const titleId = useId();

  const savePicture = async () => {
    const picture = await qrPicture(address).catch(() => null);
    setPictureError(!picture);
    if (!picture) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(picture);
    link.download = qrFileName(salonName);
    document.body.append(link);
    link.click();
    link.remove();
    // The download has started by then; the picture need not stay in memory.
    window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  };

  const printSheet = () => {
    // The sheet has to be in the page before the browser's print dialog opens on it.
    flushSync(() => setPrinting(true));
    window.print();
  };
  // Once printing is over the sheet goes again, so that printing the page itself gives the page.
  useEffect(() => {
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    return () => window.removeEventListener('afterprint', done);
  }, []);

  if (!address) return null;
  return (
    <section aria-labelledby={titleId} className={`space-y-5 ${className}`}>
      <div>
        <h3 id={titleId} className="text-sm font-bold text-slate-900">Booking link</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Your customers choose a service, a stylist and a time on this page. Pass the link on, or let them scan the code.
        </p>
      </div>

      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-3">
          {/* Written out in full, also on a narrow phone, so it can be read, checked and selected with one tap. */}
          <p className="flex min-h-11 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 select-all [overflow-wrap:anywhere]">
            <span className="sr-only">Customer booking link: </span><span className="min-w-0">{address}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copy} className={`${buttonClass} bg-[#5551FF] text-white shadow-xs hover:bg-[#433fd8]`}>
              {copyState === 'copied' ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copyState === 'copied' ? 'Copied' : 'Copy link'}
            </button>
            {/* rel="noopener": the new tab starts without what belongs to this tab alone (a reply that
                was begun, a booking draft). The salon itself reaches it through the browser's storage. */}
            <a href={address} target="_blank" rel="noopener" className={quietButton}>
              Open as customer<ExternalLink className="h-4 w-4" aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
          <CopyFeedback state={copyState} />
          <p className="rounded-xl bg-indigo-50 p-3 text-xs leading-relaxed text-indigo-900">
            Requests from this page wait on Home for your answer. Nothing is booked until you confirm.
          </p>
          {/* Study tool: the sample workspace lives in this one browser, and a study session should know how far it reaches. */}
          {researchMode() && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
              {onServer
                ? 'Demo workspace: the salon’s settings (services, team, hours, closed dates) come from the server, so the page “Open as customer” opens shows them as you saved them. Requests, the calendar and customers are still kept in this browser and shared by its tabs: a request sent there shows up on Home here, and that tab shows your answer. Another browser or device does not see those.'
                : 'Demo workspace: its data are kept in this browser and shared by all its tabs. A request sent in the tab that “Open as customer” opens shows up on Home here, and that tab shows your answer once you confirm or decline. Another browser or device is not reached.'}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <div className="w-44 rounded-2xl border border-slate-200 bg-white p-2">
            <BookingQrCode address={address} className="block h-auto w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={savePicture} className={quietButton}>
              <Download className="h-4 w-4" aria-hidden="true" />Save picture
            </button>
            <button type="button" onClick={printSheet} className={quietButton}>
              <Printer className="h-4 w-4" aria-hidden="true" />Print
            </button>
          </div>
          {pictureError && <p role="alert" className="max-w-44 text-xs text-rose-700">The picture could not be saved. Print the code instead.</p>}
        </div>
      </div>

      {/* The printed sheet: the salon's name, what the code is for, the code and the address in
          letters. It lies outside the app, which is left off the paper while this sheet is there. */}
      {printing && createPortal(
        <div className="booking-link-sheet">
          <style>{SHEET_STYLE}</style>
          {salonName && <p className="booking-link-sheet-salon">{salonName}</p>}
          <p className="booking-link-sheet-line">Book your appointment online</p>
          <BookingQrCode address={address} className="booking-link-sheet-code" />
          <p className="booking-link-sheet-address">{address}</p>
        </div>,
        document.body,
      )}
    </section>
  );
};

/** The short form for Home: the address, Copy, and the QR code behind a button. */
export const BookingLinkCompact: React.FC<BookingLinkProps> = ({ address: given, className = '' }) => {
  const address = useBookingAddress(given);
  const { copyState, copy } = useCopyLink(address);
  const [showCode, setShowCode] = useState(false);
  const codeId = useId();
  if (!address) return null;
  return (
    <section aria-label="Booking link" className={`rounded-2xl border border-slate-200/80 bg-white p-4 text-xs shadow-xs ${className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-52">
          <p className="font-semibold text-slate-900">Booking link</p>
          <p className="mt-0.5 text-slate-600 [overflow-wrap:anywhere]">{address}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={copy} className={`${buttonClass} bg-[#5551FF]/10 text-[#5551FF] hover:bg-[#5551FF]/18`}>
            {copyState === 'copied' ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            {copyState === 'copied' ? 'Copied' : 'Copy'}
          </button>
          <button type="button" onClick={() => setShowCode((shown) => !shown)} aria-expanded={showCode} aria-controls={showCode ? codeId : undefined} className={quietButton}>
            <QrCodeIcon className="h-4 w-4" aria-hidden="true" />QR code
          </button>
        </div>
      </div>
      <CopyFeedback state={copyState} />
      {showCode && (
        <div id={codeId} className="mt-3 flex flex-wrap items-center gap-4">
          <BookingQrCode address={address} className="h-36 w-36 shrink-0 rounded-xl border border-slate-200" />
          <p className="min-w-0 flex-1 basis-40 leading-relaxed text-slate-500">Customers scan the code with their phone camera and land on your booking page.</p>
        </div>
      )}
    </section>
  );
};

const segment = 'inline-flex min-h-11 items-center justify-center gap-2 px-3.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]';

/**
 * The booking link as two buttons that belong together, for the heading row of Home on a wide
 * screen: one tap copies the address, the other shows the QR code. The link is needed now and
 * then, so it is a tool beside the page's heading and takes no card among the day's figures. The
 * address itself is written out in the panel of the code; Settings › Online booking has the full card.
 */
export const BookingLinkButtons: React.FC<BookingLinkProps> = ({ address: given, className = '' }) => {
  const address = useBookingAddress(given);
  const { copyState, copy } = useCopyLink(address);
  const [showCode, setShowCode] = useState(false);
  const codeId = useId();
  const group = useRef<HTMLDivElement>(null);
  const codeButton = useRef<HTMLButtonElement>(null);
  // The panel lies over the page: a tap beside it puts it away.
  useEffect(() => {
    if (!showCode) return;
    const away = (event: PointerEvent) => { if (event.target instanceof Node && !group.current?.contains(event.target)) setShowCode(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [showCode]);
  // Copying did not work: the panel opens, with the address to mark and copy by hand.
  useEffect(() => { if (copyState === 'failed') setShowCode(true); }, [copyState]);
  if (!address) return null;
  const copied = copyState === 'copied';
  return (
    <div
      ref={group}
      role="group"
      aria-label="Booking link"
      // Escape puts the panel away and keeps the focus on its button; so does the focus moving on.
      onKeyDown={(event) => { if (event.key === 'Escape' && showCode) { event.stopPropagation(); setShowCode(false); codeButton.current?.focus(); } }}
      onBlur={(event) => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setShowCode(false); }}
      className={`relative ${className}`}
    >
      <div className="inline-flex rounded-xl border border-slate-200 bg-white shadow-xs">
        {/* As wide with "Copied" as with its name: the button beside it does not move under the pointer. */}
        <button type="button" onClick={copy} className={`${segment} min-w-[10.25rem] rounded-l-[11px]`}>
          {copied ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" /> : <Link2 className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy booking link'}
        </button>
        <button
          ref={codeButton} type="button" onClick={() => setShowCode((shown) => !shown)}
          aria-expanded={showCode} aria-controls={showCode ? codeId : undefined}
          className={`${segment} rounded-r-[11px] border-l border-slate-200 ${showCode ? 'bg-slate-50' : ''}`}
        >
          <QrCodeIcon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />QR code
        </button>
      </div>
      {/* Always in the page, so a screen reader announces the text when it appears. */}
      <span role="status" className="sr-only">{copied ? 'Booking link copied.' : ''}</span>
      {showCode && (
        <div id={codeId} tabIndex={-1} className="absolute right-0 top-full z-20 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-4 text-xs shadow-xl outline-hidden">
          <BookingQrCode address={address} className="mx-auto block h-44 w-44 rounded-xl border border-slate-200" />
          <p className="mt-3 leading-relaxed text-slate-600">Customers scan the code with their phone camera and land on your booking page.</p>
          <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-slate-700 select-all [overflow-wrap:anywhere]">{address}</p>
          {copyState === 'failed' && <p role="alert" className="mt-2 text-rose-700">The link could not be copied. Select it and copy it by hand.</p>}
        </div>
      )}
    </div>
  );
};
