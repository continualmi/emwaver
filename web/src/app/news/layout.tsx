import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { NewsMobileNav } from "@/components/news/NewsMobileNav";
import { NewsSidebar } from "@/components/news/NewsSidebar";

export default function NewsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />

      <main className="w-full px-5 py-10">
        <div className="grid h-full gap-8 md:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="hidden overflow-y-auto md:block">
            <NewsSidebar />
          </aside>

          <div className="min-w-0 overflow-hidden">
            <div className="md:hidden">
              <NewsMobileNav />
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
