import { TZDate } from "@date-fns/tz";
import { dayKey, startOfDayInZone } from "@/lib/format";

export function splitInZone(iso: string, tz: string) {
  const d = new TZDate(new Date(iso).getTime(), tz);
  return {
    date: dayKey(iso, tz),
    time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
  };
}

export function joinInZone(date: string, time: string, tz: string) {
  const d = startOfDayInZone(date, tz);
  const [h, m] = time.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return new Date(d.getTime()).toISOString();
}

export const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const label = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
    new Date(Date.UTC(2020, 0, 1, h, m)),
  );
  return { value, label };
});
