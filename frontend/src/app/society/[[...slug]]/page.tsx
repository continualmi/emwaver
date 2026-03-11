import { redirect } from "next/navigation";
import { societyRouteUrl } from "@/lib/societySite";

export default async function SocietyRedirectPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const suffix = slug && slug.length > 0 ? `/${slug.join("/")}` : "";
  redirect(societyRouteUrl(`/society${suffix}`));
}
