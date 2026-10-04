import Link from "next/link";
import { Logo } from "@/components/app/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-60 blur-3xl"
        style={{ background: "radial-gradient(35% 40% at 30% 30%, rgba(0,122,255,0.16), transparent), radial-gradient(30% 35% at 75% 70%, rgba(175,82,222,0.14), transparent)" }}
      />
      <Link href="/" className="mb-8"><Logo className="text-[20px]" /></Link>
      <div className="w-full max-w-[400px] rounded-[24px] glass-strong hairline p-7 shadow-lg animate-pop sm:p-8">{children}</div>
    </div>
  );
}
