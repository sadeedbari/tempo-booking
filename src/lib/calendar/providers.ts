import "server-only";
import { env } from "@/lib/env";
import { google } from "./google";
import { microsoft } from "./microsoft";
import type { CalendarProvider, ProviderId } from "./provider";

const all: Record<ProviderId, CalendarProvider> = { google, microsoft };

export function getProvider(id: string): CalendarProvider | null {
  const p = (all as Record<string, CalendarProvider | undefined>)[id];
  return p && env.tokenEncryptionKey && p.configured() ? p : null;
}

/** Providers a team member can connect right now. */
export const availableProviders = () =>
  Object.values(all).filter((p) => env.tokenEncryptionKey && p.configured()).map((p) => ({ id: p.id, label: p.label }));
