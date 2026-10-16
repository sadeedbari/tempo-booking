import "server-only";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { fireInquiryReceived, sendEmail } from "@/lib/messaging";
import { pushInquiryEvent } from "@/lib/push";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** A business still on the old default blue just gets Tempo's blue in its emails. */
const brandColorOrDefault = (c?: string | null) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#007AFF");
/** Keeps a visitor's text from smuggling line breaks into an email subject. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/**
 * After a website message is saved: tells the team (an email to the address the business chose, or to every
 * owner and admin, plus a push alert; the email's Reply goes straight to the visitor), then sends the visitor
 * the business's "message received" workflow. Never throws: a failed notification must not lose the message.
 */
export async function notifyInquiry(inquiryId: string) {
  await notifyTeam(inquiryId);
  await fireInquiryReceived(inquiryId);
}

async function notifyTeam(inquiryId: string) {
  try {
    const admin = createAdminClient();
    const { data: inq } = await admin
      .from("inquiries")
      .select("id, name, email, phone, message, service_name, org:organizations(id, name, slug, accent_color, notify_push, inquiry_notify_email)")
      .eq("id", inquiryId)
      .single();
    if (!inq) return;
    const org = inq.org as unknown as { id: string; name: string; slug: string; accent_color: string; notify_push: boolean; inquiry_notify_email: string | null };

    await pushInquiryEvent({ id: inq.id, name: inq.name, service_name: inq.service_name, org });

    // Who gets the email.
    let to: string[] = [];
    if (org.inquiry_notify_email) {
      to = [org.inquiry_notify_email];
    } else {
      const { data: members } = await admin.from("memberships").select("user_id, email, role").eq("org_id", org.id);
      const admins = (members ?? []).filter((m) => m.role === "owner" || m.role === "admin");
      const userIds = admins.map((m) => m.user_id as string).filter(Boolean);
      const { data: profiles } = userIds.length ? await admin.from("profiles").select("email").in("id", userIds) : { data: [] as { email: string | null }[] };
      to = [...new Set([...(profiles ?? []).map((p) => p.email), ...admins.map((m) => m.email)].filter((e): e is string => Boolean(e)))];
    }
    if (!to.length) return;

    const accent = brandColorOrDefault(org.accent_color);
    const link = `${env.appUrl}/o/${org.slug}/inquiries`;
    const lines = [
      `${inq.name} sent a message through your website.`,
      inq.service_name ? `Interested in: ${inq.service_name}` : "",
      `Email: ${inq.email}`,
      inq.phone ? `Phone: ${inq.phone}` : "",
      "",
      inq.message,
      "",
      `Reply to this email to answer ${inq.name} directly, or open it in Tempo: ${link}`,
    ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""));
    const text = lines.join("\n");
    const row = (k: string, v: string) => `<tr><td style="padding:4px 14px 4px 0;color:#6e6e73;font-size:14px;vertical-align:top">${k}</td><td style="padding:4px 0;font-size:14px">${v}</td></tr>`;
    const html = `<div style="font-family:-apple-system,Segoe UI,Inter,sans-serif;max-width:520px;margin:0 auto;padding:32px 20px;color:#1d1d1f">
<h1 style="font-size:22px;margin:0 0 4px">New message from ${esc(inq.name)}</h1>
<p style="margin:0 0 18px;color:#6e6e73;font-size:15px">Sent through the contact form for ${esc(org.name)}.</p>
<table style="border-collapse:collapse;margin-bottom:16px">${row("Email", `<a href="mailto:${esc(inq.email)}" style="color:${accent}">${esc(inq.email)}</a>`)}${inq.phone ? row("Phone", esc(inq.phone)) : ""}${inq.service_name ? row("Interested in", esc(inq.service_name)) : ""}</table>
<div style="background:#f5f5f7;border-radius:14px;padding:16px 18px;font-size:15px;line-height:1.55;white-space:pre-wrap">${esc(inq.message)}</div>
<p style="margin:18px 0 0;font-size:14px;color:#6e6e73">Reply to this email to answer ${esc(inq.name)} directly.</p>
<a href="${link}" style="display:inline-block;margin-top:14px;background:${accent};color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">Open in Tempo</a>
</div>`;

    for (const address of to) {
      const r = await sendEmail({ to: address, businessName: "Tempo", subject: oneLine(`New message from ${inq.name}`).slice(0, 150), html, text, replyTo: inq.email });
      if (!r.ok) console.error("[inquiry] email to team failed:", r.error);
    }
  } catch (e) {
    console.error("[inquiry]", e);
  }
}
