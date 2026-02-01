import { notFound, redirect } from "next/navigation";

const REDIRECTS: Record<string, string> = {
  "overview": "/",
  "installing-using": "/docs/install",
  "hardware/device": "/docs/hardware/device",
  "hardware/pinout": "/docs/hardware/pinout",
  "hardware/pinout/index": "/docs/hardware/pinout",
  "scripts": "/docs/scripts",
};

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
