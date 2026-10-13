"use client";
import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";

export type ThemePref = "light" | "dark" | "system";
const KEY = "tempo-theme";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function isDark(pref: ThemePref) {
  return pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
}

/** Sets the page theme and remembers the choice on this device. */
function applyPref(pref: ThemePref) {
  try { localStorage.setItem(KEY, pref); } catch { /* private mode: the choice just lasts for this visit */ }
  document.documentElement.dataset.theme = isDark(pref) ? "dark" : "light";
  emit();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const mq = matchMedia("(prefers-color-scheme: dark)");
  // On "System", follow the device when it switches between light and dark.
  const onSystem = () => { if (readPref() === "system") applyPref("system"); };
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { applyPref(readPref()); } };
  mq.addEventListener("change", onSystem);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    mq.removeEventListener("change", onSystem);
    window.removeEventListener("storage", onStorage);
  };
}

function useThemePref() {
  const pref = useSyncExternalStore(subscribe, readPref, () => "system" as ThemePref);
  const dark = useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme === "dark", () => false);
  return { pref, dark, choose: applyPref };
}

/** Light / Dark / System picker for Settings and the phone menu. */
export function ThemeSwitch() {
  const { pref, choose } = useThemePref();
  return (
    <Segmented<ThemePref>
      value={pref}
      onChange={choose}
      options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]}
    />
  );
}

/** One-tap light/dark button for the sidebar. */
export function ThemeToggleButton() {
  const { dark, choose } = useThemePref();
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => choose(dark ? "light" : "dark")}
      className="grid size-10 place-items-center rounded-full text-label-3 transition hover:bg-label-4/40 hover:text-label sm:size-8"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

/** Small sun/moon slider for public pages (top right of the landing page). */
export function ThemeSlider() {
  const { dark, choose } = useThemePref();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => choose(dark ? "light" : "dark")}
      className="relative inline-flex h-8 w-[58px] shrink-0 items-center rounded-full bg-surface-3 p-[3px] transition-colors"
    >
      <Sun className="absolute left-2 size-3.5 text-label-3" aria-hidden />
      <Moon className="absolute right-2 size-3.5 text-label-3" aria-hidden />
      <span
        className="relative grid size-[26px] place-items-center rounded-full bg-surface text-label shadow-[0_2px_6px_rgba(0,0,0,0.2)] transition-transform duration-300 ease-[var(--ease-apple)]"
        style={{ transform: dark ? "translateX(26px)" : "translateX(0)" }}
      >
        {dark ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
      </span>
    </button>
  );
}
