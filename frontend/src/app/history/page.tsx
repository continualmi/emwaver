import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { HistoryClient } from "@/app/history/HistoryClient";
import { dateSortKey } from "@/lib/hardwareCatalog/shared";
import { loadHardwareDevice, loadHardwareManifest } from "@/lib/hardwareCatalog/server";

export default async function HistoryPage() {
  const folders = await loadHardwareManifest();
  const devices = await Promise.all(
    folders.map(async (folder) => {
      try {
        return await loadHardwareDevice(folder);
      } catch {
        return { folder, title: folder };
      }
    }),
  );

  devices.sort(
    (a, b) => dateSortKey(b.designDate || b.date) - dateSortKey(a.designDate || a.date),
  );

  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-5 py-10">
        <HistoryClient devices={devices} />
      </main>
      <SiteFooter />
    </div>
  );
}
