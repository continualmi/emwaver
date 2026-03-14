import { DocsMobileNav } from "@/components/docs/DocsMobileNav";
import { DocsSidebar } from "@/components/docs/DocsSidebar";
import { DocsHighlight } from "@/components/docs/DocsHighlight";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
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
  );
}
