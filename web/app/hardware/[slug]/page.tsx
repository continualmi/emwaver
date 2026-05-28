import { redirect } from "next/navigation";
import { getHardwareCatalog } from "@/lib/emwaver/hardwareCatalog";

export function generateStaticParams() {
  return getHardwareCatalog().map((device) => ({ slug: device.slug }));
}

export default async function HardwareDevicePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/build/${slug}`);
}
