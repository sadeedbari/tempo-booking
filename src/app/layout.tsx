import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import { RegisterSW } from "@/components/app/pwa";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Tempo — Scheduling, beautifully simple", template: "%s · Tempo" },
  description: "Online booking for teams. Appointments, meetings, payments and reminders in one calm place.",
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <ToastProvider>{children}</ToastProvider>
        <RegisterSW />
      </body>
    </html>
  );
}
