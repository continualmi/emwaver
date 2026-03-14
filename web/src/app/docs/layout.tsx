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

      <main className="w-full px-5 py-10">
        <div className="grid gap-6 md:grid-cols-[280px_minmax(0,1fr)] md:gap-8">
          <aside className="hidden md:block">
            <div className="pr-1 pb-3">
              <DocsSidebar />
            </div>
          </aside>

          <div className="min-w-0">
            <div className="md:hidden">
              <DocsMobileNav />
            </div>

            <div className="mt-4 md:mt-0">
              <article className="prose-emw pb-10">{children}</article>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
