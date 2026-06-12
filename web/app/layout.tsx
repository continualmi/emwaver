import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { SiteFooter } from "@/components/emwaver/SiteFooter";
import "./globals.css";

const displaySans = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "EMWaver",
    template: "%s · EMWaver",
  },
  description:
    "EMWaver is a local-first, open-source electronics platform for app-managed hardware control and AI-assisted scripting.",
  icons: {
    icon: "/favicon.ico",
    apple: "/app-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${displaySans.variable} ${mono.variable} emwaver-shell relative isolate min-h-screen antialiased`}>
        <div className="global-bg pointer-events-none fixed inset-0 z-0">
          <img
            src="/2015_upscale.jpg"
            alt=""
            className="global-bg-image h-full w-full object-cover"
            style={{ opacity: "var(--bg-image-opacity)" }}
          />
          <div className="global-bg-overlay absolute inset-0" style={{ background: "var(--bg-overlay-gradient)" }} />
        </div>

        <div className="relative z-10">
          {children}
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
