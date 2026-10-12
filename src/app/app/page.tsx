import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getMyOrgs, requireUser } from "@/lib/auth";

export default async function AppEntry() {
  await requireUser("/app");
  const orgs = await getMyOrgs();
  if (orgs.length === 0) redirect("/onboarding");
  const last = (await cookies()).get("tempo_org")?.value;
  const target = orgs.find((o) => o.slug === last) ?? orgs[0];
  redirect(`/o/${target.slug}/dashboard`);
}
