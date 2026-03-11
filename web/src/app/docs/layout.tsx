import { SiteHeader } from "@/components/SiteHeader";
import { DocsMobileNav } from "@/components/docs/DocsMobileNav";
import { DocsSidebar } from "@/components/docs/DocsSidebar";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell-fixed docs-mode">
      <SiteHeader />

      <main className="app-shell-main w-full px-5 py-4 md:py-6">
        <div className="grid h-full min-h-0 gap-6 md:grid-cols-[280px_minmax(0,1fr)] md:gap-8">
          <aside className="hidden min-h-0 md:block">
            <div className="h-full overflow-y-auto pr-1 pb-3">
              <DocsSidebar />
            </div>
          </aside>

          <div className="min-w-0 min-h-0 overflow-hidden">
            <div className="md:hidden">
              <DocsMobileNav />
            </div>

            <div className="mt-4 h-full min-h-0 overflow-y-auto md:mt-0">
              <article className="prose-emw pb-10">{children}</article>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
