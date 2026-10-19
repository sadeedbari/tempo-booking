"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Modal sheet — slides up as a bottom sheet on phones and floats as a
 * centered card on larger screens, over a frosted backdrop. It is a named modal dialog (named by its title): focus moves
 * into it when it opens, Tab stays inside it, and focus returns to what opened it when it closes.
 */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// The last element outside any dialog that had focus: what opened the sheet. (A field with autoFocus takes focus before the
// sheet's effect runs, so document.activeElement at that point is already inside the dialog.)
let lastOutside: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener("focusin", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && !t.closest("[role=dialog]")) lastOutside = t;
  });
}

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  // Focus: in on open (unless something inside already took it, like an autoFocus field), back to the opener on close.
  useEffect(() => {
    if (!open) return;
    const opener = lastOutside;
    const box = panel.current;
    if (box && !box.contains(document.activeElement)) {
      (box.querySelector<HTMLElement>(FOCUSABLE) ?? box).focus();
    }
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      // Keep Tab / Shift+Tab inside the dialog.
      if (e.key !== "Tab" || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return e.preventDefault();
      const first = items[0], last = items[items.length - 1];
      const at = document.activeElement;
      if (!panel.current.contains(at)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : "Dialog"}>
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[3px] animate-fade" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className={cn(
          "relative flex outline-none max-h-[92dvh] w-full flex-col overflow-hidden glass-strong hairline shadow-lg animate-sheet",
          "rounded-t-[22px] sm:max-w-lg sm:rounded-[22px]",
          className,
        )}
      >
        <div className="mx-auto mt-2 h-1.5 w-9 rounded-full bg-label-4 sm:hidden" />
        {(title || subtitle) && (
          <div className="flex items-start gap-3 px-5 pt-4 pb-3 sm:px-6 sm:pt-6">
            <div className="min-w-0 flex-1">
              {title && <h2 id={titleId} className="text-[20px] font-semibold leading-tight">{title}</h2>}
              {subtitle && <p className="mt-1 text-[14px] text-label-2">{subtitle}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 sm:size-8 text-label-2 transition hover:bg-surface-3"
            >
              <X className="size-4" strokeWidth={2.5} />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 pb-6 sm:px-6">{children}</div>
        {footer && <div className="border-t border-separator bg-surface/40 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
