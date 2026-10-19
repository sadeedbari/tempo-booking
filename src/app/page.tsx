import type { Metadata } from "next";
import { Faq } from "@/components/marketing/faq";
import { FeatureGroups } from "@/components/marketing/features";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { JsonLd } from "@/components/marketing/json-ld";
import { Pricing } from "@/components/marketing/pricing";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

const TITLE = "Tempo: Online Booking Software for Service Businesses";
const DESCRIPTION = "Online booking, group classes, reminders and deposits for salons, clinics, studios and more. From $15 CAD/month. 14-day free trial, no card.";

// Page-level metadata overrides the generic title and description in layout.tsx (absolute: skips the "· Tempo" title template).
export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: SITE_URL + "/" },
  openGraph: {
    type: "website",
    url: SITE_URL + "/",
    siteName: SITE_NAME,
    locale: "en_CA",
    title: "Tempo: online booking that feels effortless",
    description: "Take appointments and classes, send reminders and collect deposits. 14-day free trial. No credit card required.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tempo: online booking that feels effortless",
    description: "Take appointments and classes, send reminders and collect deposits. 14-day free trial. No credit card required.",
  },
};

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  return (
    // overflow-x: clip (not hidden) keeps the blurred glow from causing sideways scroll without breaking the sticky header.
    <div className="relative overflow-x-clip">
      {/* Ambient colour: decorative, same width as the viewport, so it cannot widen the page. */}
      <div aria-hidden data-decor className="pointer-events-none absolute inset-x-0 -top-40 -z-10 h-[640px] opacity-70 blur-3xl"
        style={{ background: "radial-gradient(40% 50% at 30% 40%, rgba(0,122,255,0.20), transparent), radial-gradient(35% 45% at 70% 30%, rgba(175,82,222,0.16), transparent), radial-gradient(30% 40% at 55% 70%, rgba(52,199,89,0.12), transparent)" }} />

      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-accent-fill focus:px-4 focus:py-3 focus:text-base focus:font-medium focus:text-white">
        Skip to main content
      </a>
      <SiteHeader signedIn={signedIn} />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero signedIn={signedIn} />
        <FeatureGroups />
        <Pricing signedIn={signedIn} />
        <Faq />
        <FinalCta signedIn={signedIn} />
      </main>
      <SiteFooter />
      <JsonLd />
    </div>
  );
}
