import clsx, { type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Slugs that can't be used for teams because they collide with app routes. */
export const RESERVED_SLUGS = new Set([
  "api", "app", "o", "login", "signup", "logout", "auth", "onboarding", "invite", "booking",
  "settings", "admin", "dashboard", "waitlist", "help", "support", "pricing", "about", "terms", "privacy",
  "blog", "docs", "preview", "static", "_next", "favicon", "tempo", "www", "mail", "embed",
  "forgot", "reset", "sitemap", "robots", "manifest", "icon", "icons", "opengraph-image", "twitter-image",
]);

export const PALETTE = [
  "#007AFF", "#34C759", "#FF9500", "#FF2D55", "#AF52DE", "#5856D6", "#30B0C7", "#FF3B30", "#A2845E",
];
