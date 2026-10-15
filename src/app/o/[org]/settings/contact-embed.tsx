"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";

type Kind = "popup" | "inline" | "link";

/** Copy-paste snippets for putting the "send us a message" form on another website. */
export function ContactEmbedSection({
  appUrl, slug, services, enabled,
}: {
  appUrl: string; slug: string; services: { slug: string; name: string }[]; enabled: boolean;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>("popup");
  const [service, setService] = useState("");
  const [copied, setCopied] = useState(false);

  const script = `<script src="${appUrl}/embed.js" data-slug="${slug}" async></script>`;
  const code =
    kind === "popup"
      ? `${script}\n\n<!-- Put this on any button or link: -->\n<button data-tempo-contact${service ? ` data-tempo-service="${service}"` : ""}>Ask a question</button>`
      : kind === "inline"
        ? `${script}\n\n<!-- The form appears right here on the page: -->\n<div data-tempo-form${service ? ` data-tempo-service="${service}"` : ""}></div>`
        : `${appUrl}/${slug}/contact${service ? `?service=${service}` : ""}`;

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    toast("Copied");
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section id="contact-form" className="scroll-mt-6">
      <h2 className="text-[20px] font-semibold">Contact form for your website</h2>
      <p className="mt-0.5 mb-4 text-[14px] text-label-2">
        Let visitors ask a question before they book: name, contact details, the service they are interested in, and a message.
        Each one lands in <Link href={`/o/${slug}/inquiries`} className="text-accent underline">Inquiries</Link>, you are notified, and they are added to your customers.
      </p>
      <div className="space-y-4 rounded-[16px] bg-surface p-5 shadow-sm hairline">
        {!enabled && (
          <p className="rounded-[12px] bg-orange/10 px-3.5 py-2.5 text-[14px] font-medium text-orange">
            The contact form is turned off. Turn it on in the Business section above and save, or visitors will see a &ldquo;not taking messages&rdquo; notice.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            size="sm"
            value={kind}
            onChange={setKind}
            options={[{ value: "popup", label: "Pop-up button" }, { value: "inline", label: "On the page" }, { value: "link", label: "Direct link" }]}
          />
          <Select value={service} onChange={(e) => setService(e.target.value)} className="h-10 w-auto max-w-full sm:h-8 sm:text-[13px]" aria-label="Pre-select a service">
            <option value="">Visitor chooses the service</option>
            {services.map((s) => <option key={s.slug} value={s.slug}>{s.name} pre-selected</option>)}
          </Select>
        </div>

        <div className="relative">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-[12px] bg-surface-2 p-4 pr-14 font-mono text-[12.5px] leading-relaxed">{code}</pre>
          <button onClick={copy} className="absolute right-2.5 top-2.5 grid size-10 place-items-center sm:size-8 rounded-[9px] bg-surface text-label-2 shadow-sm hairline transition hover:text-label" aria-label="Copy contact form code">
            {copied ? <Check className="size-4 text-green" /> : <Copy className="size-4" />}
          </button>
        </div>

        <p className="text-[13px] text-label-2">
          {kind === "popup" && "Paste the script once near the end of your page (you can reuse the one from the booking pop-up), then add data-tempo-contact to any button or link."}
          {kind === "inline" && "Paste the script once, then place the empty div where the form should appear. It grows to fit the form and works on phones."}
          {kind === "link" && "A plain link to your contact page. Use it in social bios, emails or QR codes."}
        </p>
      </div>
    </section>
  );
}
