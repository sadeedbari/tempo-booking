"use client";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Modal sheet — slides up as a bottom sheet on phones and floats as a
 * centered card on larger screens, over a frosted backdrop.
 */
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
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
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[3px] animate-fade" onClick={onClose} />
      <div
        className={cn(
          "relative flex max-h-[92dvh] w-full flex-col overflow-hidden glass-strong hairline shadow-lg animate-sheet",
          "rounded-t-[22px] sm:max-w-lg sm:rounded-[22px]",
          className,
        )}
      >
        <div className="mx-auto mt-2 h-1.5 w-9 rounded-full bg-label-4 sm:hidden" />
        {(title || subtitle) && (
          <div className="flex items-start gap-3 px-5 pt-4 pb-3 sm:px-6 sm:pt-6">
            <div className="min-w-0 flex-1">
              {title && <h2 className="text-[20px] font-semibold leading-tight">{title}</h2>}
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
