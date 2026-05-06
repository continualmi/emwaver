import type { Metadata } from "next";
import "./emwaver/globals.css";

export const metadata: Metadata = {
  title: "EMWaver",
  description:
    "EMWaver is a local-first, open-source electronics platform for app-managed hardware control and AI-assisted scripting.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
