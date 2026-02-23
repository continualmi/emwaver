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
    <div className="app-shell-fixed docs-mode">
      <SiteHeader />

      <main className="app-shell-main mx-auto w-full max-w-6xl px-5 py-10">
        <div className="grid h-full gap-8 md:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="hidden overflow-y-auto md:block">
            <DocsSidebar />
          </aside>

          <div className="min-w-0 overflow-hidden">
            <div className="md:hidden">
              <DocsMobileNav />
            </div>

            <div className="mt-6 h-full overflow-y-auto md:mt-0">
              <article className="prose-emw pb-16">{children}</article>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
