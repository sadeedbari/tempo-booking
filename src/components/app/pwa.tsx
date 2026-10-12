"use client";
import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

type InstallEvent = Event & { prompt: () => Promise<void> };
const KEY = "tempo_install_dismissed";

/** Registers the service worker (needed for "Install app" on Android/Chrome). */
export function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}

/**
 * Phone-only banner inside the app: one tap to install on Android, and Add-to-Home-Screen
 * steps on iPhone (Safari doesn't allow a button for it). Hidden once installed or dismissed.
 */
export function InstallBanner() {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [steps, setSteps] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try { dismissed = localStorage.getItem(KEY) === "1"; } catch {}
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as InstallEvent); };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // Defer the state updates so they don't run synchronously inside the effect.
    const t = setTimeout(() => { setIos(isIos); setHidden(standalone || dismissed); }, 0);
    return () => { clearTimeout(t); window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (hidden || (!evt && !ios)) return null;
  const dismiss = () => { setHidden(true); try { localStorage.setItem(KEY, "1"); } catch {} };

  return (
    <div className="mb-4 flex items-start gap-3 rounded-[16px] bg-accent-soft p-3.5 lg:hidden">
      <div className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-accent text-white"><Download className="size-5" /></div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold">Add Tempo to your home screen</div>
        {steps ? (
          <p className="mt-1 text-[13px] text-label-2">
            Tap <Share className="mx-0.5 inline size-4 align-text-bottom" /> in Safari, then <b>Add to Home Screen</b>.
          </p>
        ) : (
          <p className="mt-1 text-[13px] text-label-2">Opens full screen like a regular app.</p>
        )}
        {!steps && (
          <button
            onClick={() => (evt ? evt.prompt().then(dismiss) : setSteps(true))}
            className="mt-2 h-10 rounded-[10px] bg-accent px-4 text-[14px] font-semibold text-white"
          >
            {evt ? "Install app" : "Show me how"}
          </button>
        )}
      </div>
      <button onClick={dismiss} aria-label="Dismiss" className="grid size-10 shrink-0 place-items-center rounded-full text-label-3"><X className="size-4" /></button>
    </div>
  );
}
