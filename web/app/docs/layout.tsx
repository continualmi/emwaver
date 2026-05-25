import { DocsMobileNav } from "@/components/emwaver/docs/DocsMobileNav";
import { DocsSidebar } from "@/components/emwaver/docs/DocsSidebar";
import { DocsHighlight } from "@/components/emwaver/docs/DocsHighlight";
import { SiteHeader } from "@/components/emwaver/SiteHeader";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <div className="docs-mode">
        <DocsHighlight />
        <aside className="docs-sidebar-desktop">
          <DocsSidebar />
        </aside>

        <div className="docs-content">
          <div className="docs-mobile-bar">
            <DocsMobileNav />
          </div>

          <article className="prose-emw docs-article">{children}</article>
        </div>
      </div>
    </>
  );
}
