"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";

type Kind = "popup" | "floating" | "link";

/** Copy-paste snippets for putting the booking page (or one service) on another website. */
export function EmbedSection({
  appUrl, slug, accent, services,
}: {
  appUrl: string; slug: string; accent: string; services: { slug: string; name: string }[];
}) {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>("popup");
  const [service, setService] = useState("");
  const [copied, setCopied] = useState(false);

  const script = `<script src="${appUrl}/embed.js" data-slug="${slug}"${kind === "floating" ? `${service ? ` data-service="${service}"` : ""} data-floating data-label="Book now" data-color="${accent}"` : ""} async></script>`;
  const code =
    kind === "popup"
      ? `${script}\n\n<!-- Put this on any button or link: -->\n<button data-tempo-open${service ? ` data-tempo-service="${service}"` : ""}>Book now</button>`
      : kind === "floating"
        ? script
        : `${appUrl}/${slug}${service ? `?service=${service}` : ""}`;

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    toast("Copied");
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section>
      <h2 className="text-[20px] font-semibold">Add to your website</h2>
      <p className="mt-0.5 mb-4 text-[14px] text-label-2">
        Let customers book without leaving your site. A pop-up opens over the page; on phones it fills the screen.
      </p>
      <div className="space-y-4 rounded-[16px] bg-surface p-5 shadow-sm hairline">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            size="sm"
            value={kind}
            onChange={setKind}
            options={[{ value: "popup", label: "Pop-up button" }, { value: "floating", label: "Floating button" }, { value: "link", label: "Direct link" }]}
          />
          <Select value={service} onChange={(e) => setService(e.target.value)} className="h-8 w-auto max-w-full text-[13px]" aria-label="What should open">
            <option value="">Whole booking page</option>
            {services.map((s) => <option key={s.slug} value={s.slug}>{s.name} only</option>)}
          </Select>
        </div>

        <div className="relative">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-[12px] bg-surface-2 p-4 pr-14 font-mono text-[12.5px] leading-relaxed">{code}</pre>
          <button onClick={copy} className="absolute right-2.5 top-2.5 grid size-8 place-items-center rounded-[9px] bg-surface text-label-2 shadow-sm hairline transition hover:text-label" aria-label="Copy">
            {copied ? <Check className="size-4 text-green" /> : <Copy className="size-4" />}
          </button>
        </div>

        <p className="text-[13px] text-label-2">
          {kind === "popup" && "Paste the script once near the end of your page, then add data-tempo-open to any button or link. Existing links to your booking page work too: add data-tempo-open to them."}
          {kind === "floating" && "Paste this once, near the end of your page. A \"Book now\" button appears in the bottom-right corner on every page that has it."}
          {kind === "link" && "A plain link you can use anywhere: social bios, emails, QR codes. It opens your booking page."}
        </p>
        {kind !== "link" && (
          <p className="text-[13px] text-label-3">
            Deposits are paid on Stripe&apos;s secure page, so the customer briefly leaves your site and comes back to a confirmation page.
          </p>
        )}
      </div>
    </section>
  );
}
