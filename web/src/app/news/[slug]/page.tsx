import { notFound } from "next/navigation";
import { getNewsPost, NEWS_POSTS } from "@/lib/newsPosts";

export function generateStaticParams() {
  return NEWS_POSTS.map((post) => ({ slug: post.slug }));
}

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
