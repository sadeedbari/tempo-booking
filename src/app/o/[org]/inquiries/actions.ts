"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth";
import { friendlyDbError as friendly } from "@/lib/db-errors";
import type { InquiryStatus } from "@/lib/types";

export type InquiryActionResult = { ok?: boolean; error?: string };

const STATUSES: InquiryStatus[] = ["new", "handled", "archived"];
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

/** Row Level Security limits every change here to the signed-in person's own team. */
async function run(slug: string, id: string, change: (db: Awaited<ReturnType<typeof createClient>>, orgId: string) => PromiseLike<{ error: { message: string; code?: string } | null }>, adminOnly = false): Promise<InquiryActionResult> {
  try {
    const { org, isAdmin } = await getOrgContext(slug);
    if (adminOnly && !isAdmin) return { error: "Only owners and admins can do that." };
    if (!isId(id)) return { error: "That message wasn't found." };
    const { error } = await change(await createClient(), org.id);
    if (error) return { error: friendly(error) };
    revalidatePath(`/o/${slug}`, "layout");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setInquiryStatus(slug: string, id: string, status: InquiryStatus) {
  if (!STATUSES.includes(status)) return { error: "Unknown status." } as InquiryActionResult;
  return run(slug, id, (db, orgId) => db.from("inquiries").update({ status }).eq("id", id).eq("org_id", orgId));
}

export async function saveInquiryNote(slug: string, id: string, note: string) {
  const text = String(note ?? "").trim().slice(0, 2000);
  return run(slug, id, (db, orgId) => db.from("inquiries").update({ note: text || null }).eq("id", id).eq("org_id", orgId));
}

export async function deleteInquiry(slug: string, id: string) {
  return run(slug, id, (db, orgId) => db.from("inquiries").delete().eq("id", id).eq("org_id", orgId), true);
}
