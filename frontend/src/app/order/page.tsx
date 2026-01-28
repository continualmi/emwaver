import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { OrderClient } from "@/app/order/OrderClient";

export default function OrderPage() {
  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-5 py-10">
        <OrderClient />
      </main>
      <SiteFooter />
    </div>
  );
}
