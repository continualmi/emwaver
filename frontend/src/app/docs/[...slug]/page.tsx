import { notFound, redirect } from "next/navigation";

const REDIRECTS: Record<string, string> = {
  "overview": "/",
  "installing-using": "/install",
  "hardware/device": "/device",
  "hardware/pinout": "/pinout",
  "hardware/pinout/index": "/pinout",
  "scripts": "/scripts",
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
