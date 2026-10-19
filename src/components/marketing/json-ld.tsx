import { BASE_CENTS, CURRENCY, STAFF_PER_LOCATION, TRIAL_DAYS, TRIAL_LIMITS } from "@/lib/billing";
import { LEGAL } from "@/lib/legal";
import { SITE_NAME, SITE_URL } from "@/lib/site";

/** Structured data for search engines: the product, its real price (from billing constants) and who runs it. No ratings or reviews. */
export function buildJsonLd() {
  const price = (BASE_CENTS / 100).toString();
  const currency = CURRENCY.toUpperCase();
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: LEGAL.operator,
        brand: { "@type": "Brand", name: SITE_NAME },
        url: SITE_URL,
        // Square, 512x512, crawlable (Google's logo guidance: at least 112x112).
        logo: `${SITE_URL}/icons/icon-512.png`,
        email: LEGAL.contactEmail,
        contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: LEGAL.contactEmail },
      },
      {
        // Tells Google the site name. No SearchAction: there is no site search.
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: SITE_URL,
        inLanguage: "en-CA",
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#software`,
        name: SITE_NAME,
        url: SITE_URL,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        inLanguage: "en-CA",
        featureList: [
          "Online booking page", "Group classes with waitlist", "Deposits with Stripe",
          "Email and text reminders", "Multiple locations", "Contact form and website embeds",
        ],
        description: "Online booking software for salons, clinics, studios, classes and mobile services.",
        publisher: { "@id": `${SITE_URL}/#organization` },
        offers: {
          "@type": "Offer",
          price,
          priceCurrency: currency,
          description: `Base plan with ${TRIAL_LIMITS.locations} location and ${STAFF_PER_LOCATION} staff. ${TRIAL_DAYS}-day free trial, no credit card required.`,
          priceSpecification: { "@type": "UnitPriceSpecification", price, priceCurrency: currency, billingDuration: 1, unitCode: "MON" },
        },
      },
    ],
  };
}

export function JsonLd() {
  // "<" is escaped so no string in the data can ever close the script tag.
  const json = JSON.stringify(buildJsonLd()).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
