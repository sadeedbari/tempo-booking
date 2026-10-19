import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import { RegisterSW } from "@/components/app/pwa";
import { ToastProvider } from "@/components/ui/toast";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  // Makes every relative URL in metadata (canonical, og:image) absolute and production-only.
  metadataBase: new URL(SITE_URL),
  title: { default: "Tempo: Online Booking Software for Service Businesses", template: "%s · Tempo" },
  description: "Online booking, group classes, reminders and deposits for salons, clinics, studios and more. From $15 CAD/month. 14-day free trial, no card.",
  openGraph: { siteName: "Tempo", locale: "en_CA", type: "website" },
  twitter: { card: "summary_large_image" },
  applicationName: "Tempo",
  appleWebApp: { capable: true, title: "Tempo", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-180.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("tempo-theme")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-CA" suppressHydrationWarning>
      <head>
        {/* Applies the saved Light / Dark / System choice before first paint, so there is no flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <ToastProvider>{children}</ToastProvider>
        <RegisterSW />
      </body>
    </html>
  );
}
