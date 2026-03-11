import { Suspense } from "react";
import OrderConfirmedClient from "./OrderConfirmedClient";

export const dynamic = "force-dynamic";

export default function OrderConfirmedPage() {
  // Next.js requires useSearchParams() to be under a suspense boundary.
  return (
    <Suspense>
      <OrderConfirmedClient />
    </Suspense>
  );
}
