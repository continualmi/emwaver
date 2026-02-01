import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { DocsMobileNav } from "@/components/docs/DocsMobileNav";
import { DocsSidebar } from "@/components/docs/DocsSidebar";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-8 md:grid-cols-[280px_minmax(0,1fr)] md:items-start">
          <aside className="hidden md:block">
            <div className="sticky top-24">
              <DocsSidebar />
            </div>
          </aside>

          <div className="min-w-0">
            <div className="md:hidden">
              <DocsMobileNav />
            </div>

            <div className="mt-6 md:mt-0">
              <article className="prose-emw">{children}</article>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
