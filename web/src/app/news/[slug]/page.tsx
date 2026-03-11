import { notFound } from "next/navigation";
import { getNewsPost } from "@/lib/newsPosts";

export default async function NewsPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getNewsPost(slug);
  if (!post) return notFound();

  const Content = post.Content;
  return <Content />;
}
