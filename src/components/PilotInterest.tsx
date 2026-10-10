import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ExternalLink, LoaderCircle, Mail, X } from 'lucide-react';
import { WAITLIST_FORM_URL } from '../config';

export const PilotInterest: React.FC = () => {
  const [isVisible, setIsVisible] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [formLoaded, setFormLoaded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  const openForm = () => {
    setFormLoaded(false);
    setIsOpen(true);
  };

  return (
    <>
      {isVisible && (
        <section
          aria-labelledby="pilot-banner-title"
          className="mx-4 mt-2 mb-2 rounded-2xl border border-[#5551FF]/15 bg-[#EFEEFF] p-4 sm:mx-8 sm:px-5 lg:mx-10"
        >
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-3">
              <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/80 text-[#5551FF] sm:flex">
                <Mail className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 id="pilot-banner-title" className="text-sm font-semibold text-slate-900">
                  Interested in a future pilot?
                </h2>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600">
                  This is a student prototype. Leave your email if you would like our team to
                  contact you about a possible future pilot for your business.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pl-[52px] xl:pl-0">
              <button
                type="button"
                onClick={openForm}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#5551FF] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#433fd8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]"
              >
                Register interest
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setIsVisible(false)}
                className="rounded-xl px-3 py-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-white/70 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]"
              >
                Not now
              </button>
            </div>
          </div>
        </section>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby="pilot-form-title"
        aria-describedby="pilot-form-description"
        onClose={() => setIsOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setIsOpen(false);
        }}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border-0 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-900/50 backdrop:backdrop-blur-xs"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 id="pilot-form-title" className="text-base font-semibold text-slate-900">
              Register interest in a future pilot
            </h2>
            <p id="pilot-form-description" className="mt-1.5 max-w-lg text-xs leading-relaxed text-slate-500">
              Leave your email for possible pilot follow-up from our student team. Joining is
              optional and does not commit you to using or paying for a product.
            </p>
          </div>
          <button
            type="button"
            autoFocus
            onClick={() => setIsOpen(false)}
            aria-label="Close interest form"
            className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-[#5551FF]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {isOpen && (
          <div className="relative h-[min(560px,60dvh)] min-h-48 bg-slate-50">
            {!formLoaded && (
              <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-slate-500">
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading the form…
              </div>
            )}
            <iframe
              src={`${WAITLIST_FORM_URL}?embedded=true`}
              title="Pilot interest form"
              onLoad={() => setFormLoaded(true)}
              className="relative h-full w-full border-0"
            />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 text-xs">
          <span className="text-slate-500">Prefer a separate tab?</span>
          <a
            href={WAITLIST_FORM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded font-semibold text-[#5551FF] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]"
          >
            Open interest form
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </dialog>
    </>
  );
};
