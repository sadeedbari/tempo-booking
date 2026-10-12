"use client";
import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { removePushSubscription, savePushSubscription } from "@/app/push-actions";

type State = "loading" | "unsupported" | "needs-install" | "blocked" | "off" | "on";

function keyBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Notification state for this phone/browser, plus turn on / turn off. */
function usePush(vapidKey: string) {
  const [state, setState] = useState<State>("loading");
  const [pending, start] = useTransition();
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      let next: State;
      if (ios && !standalone) next = "needs-install"; // iPhone only allows notifications for apps on the home screen
      else if (!supported || !vapidKey) next = "unsupported";
      else if (Notification.permission === "denied") next = "blocked";
      else {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        next = sub && Notification.permission === "granted" ? "on" : "off";
      }
      if (alive) setState(next);
    })().catch(() => alive && setState("unsupported"));
    return () => { alive = false; };
  }, [vapidKey]);

  const enable = () =>
    start(async () => {
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") { setState(perm === "denied" ? "blocked" : "off"); return; }
        const reg = await navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready);
        const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) }));
        const r = await savePushSubscription(sub.toJSON(), navigator.userAgent);
        if (r.error) { toast(r.error, "error"); return; }
        setState("on");
        toast("Notifications are on for this device");
      } catch {
        toast("Couldn't turn on notifications on this device.", "error");
      }
    });

  const disable = () =>
    start(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (sub) { await removePushSubscription(sub.endpoint); await sub.unsubscribe(); }
        setState("off");
      } catch {
        toast("Couldn't turn off notifications.", "error");
      }
    });

  return { state, pending, enable, disable };
}

const HELP: Partial<Record<State, string>> = {
  "needs-install": "On iPhone, first add Tempo to your home screen (Share, then Add to Home Screen) and open it from there. Then turn notifications on.",
  blocked: "Notifications are blocked for Tempo on this device. Allow them in your phone or browser settings, then reload.",
  unsupported: "This browser can't receive notifications.",
};

/** Settings row: turn notifications on or off for this device. */
export function PushDeviceCard({ vapidKey, teamEnabled }: { vapidKey: string; teamEnabled: boolean }) {
  const { state, pending, enable, disable } = usePush(vapidKey);
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-[16px] bg-surface p-4 shadow-sm hairline">
      <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-accent text-white">
        {state === "on" ? <Bell className="size-5" /> : <BellOff className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium">Notifications on this device</div>
        <div className="text-[13px] text-label-2">
          {state === "on" ? "On. You'll be alerted about new, requested, rescheduled and cancelled bookings." : HELP[state] ?? "Get an alert on this device for new, requested, rescheduled and cancelled bookings."}
          {!teamEnabled && state !== "needs-install" && state !== "unsupported" && " Your team has notifications switched off, so none will be sent until an admin turns them back on."}
        </div>
      </div>
      {state === "off" && <Button pill loading={pending} onClick={enable}>Turn on</Button>}
      {state === "on" && <Button pill variant="gray" loading={pending} onClick={disable}>Turn off</Button>}
    </div>
  );
}

const KEY = "tempo_push_prompt_dismissed";

/** A nudge at the top of the app until this device has notifications on (or the person says no thanks). */
export function PushBanner({ vapidKey, teamEnabled }: { vapidKey: string; teamEnabled: boolean }) {
  const { state, pending, enable } = usePush(vapidKey);
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    let d = false;
    try { d = localStorage.getItem(KEY) === "1"; } catch {}
    const t = setTimeout(() => setDismissed(d), 0);
    return () => clearTimeout(t);
  }, []);
  if (!teamEnabled || dismissed || state !== "off") return null;
  return (
    <div className="mb-4 flex items-start gap-3 rounded-[16px] bg-accent-soft p-3.5">
      <div className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-accent text-white"><Bell className="size-5" /></div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold">Get notified about bookings</div>
        <p className="mt-1 text-[13px] text-label-2">An alert when a booking is made, requested, rescheduled or cancelled.</p>
        <button onClick={enable} disabled={pending} className="mt-2 h-10 rounded-[10px] bg-accent px-4 text-[14px] font-semibold text-white disabled:opacity-50">Turn on notifications</button>
      </div>
      <button onClick={() => { setDismissed(true); try { localStorage.setItem(KEY, "1"); } catch {} }} aria-label="Dismiss" className="grid size-10 shrink-0 place-items-center rounded-full text-label-3"><X className="size-4" /></button>
    </div>
  );
}
