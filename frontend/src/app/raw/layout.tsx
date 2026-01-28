import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export default function RawLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
      <SiteFooter />
    </div>
  );
}
