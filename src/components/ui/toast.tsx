"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";

type Toast = { id: number; message: string; tone: "success" | "error" };
const Ctx = createContext<(message: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      {/* Two persistent live regions (they must exist before a message is added or it is not read): polite for
          confirmations, assertive alert for errors. Each message is in exactly one of them, so nothing is read twice. */}
      {(["success", "error"] as const).map((tone) => (
        <div
          key={tone}
          role={tone === "error" ? "alert" : "status"}
          aria-live={tone === "error" ? "assertive" : "polite"}
          aria-atomic="false"
          className={`pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4 ${tone === "error" ? "top-16" : "top-4"}`}
        >
          {toasts.filter((t) => t.tone === tone).map((t) => (
            <div
              key={t.id}
              className="pointer-events-auto flex items-center gap-2.5 rounded-full glass-strong hairline px-4 py-2.5 text-[14px] font-medium shadow-lg animate-pop"
            >
              {t.tone === "success" ? (
                <CheckCircle2 className="size-[18px] text-green" aria-hidden />
              ) : (
                <AlertCircle className="size-[18px] text-red" aria-hidden />
              )}
              {t.message}
            </div>
          ))}
        </div>
      ))}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
