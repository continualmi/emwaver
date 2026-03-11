import { redirect } from "next/navigation";

export default async function LegacyNewsPostRedirect({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  const joined = slug.join("/");

  // Legacy path: /news/posts/<name>.html
  // New path: /news/<name>
  const base = joined.replace(/\.html$/i, "");
  redirect(`/news/${base}`);
}
