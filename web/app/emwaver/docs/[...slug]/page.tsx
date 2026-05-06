import { notFound, redirect } from "next/navigation";

const REDIRECTS: Record<string, string> = {
  "overview": "/",
  "installing-using": "/emwaver/docs/install",
  "hardware/device": "/emwaver/docs/hardware",
  "hardware/pinout/index": "/emwaver/docs/hardware/pinout",
  "daemon": "/emwaver/docs",
};

export function generateStaticParams() {
  return Object.keys(REDIRECTS).map((key) => ({ slug: key.split("/") }));
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  const key = slug.join("/");
  const to = REDIRECTS[key];
  if (to) redirect(to);
  return notFound();
}
