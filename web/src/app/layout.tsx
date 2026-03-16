import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
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
    "EMWaver is a Continual MI electronics platform with app-managed firmware, AI-first workflows, and host-backed or autonomous supported boards.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${displaySans.variable} ${mono.variable} pt-12 antialiased`}>
        <div className="fixed inset-x-0 top-0 z-[60] flex h-12 items-center justify-center bg-amber-500/12 px-4 shadow-[0_1px_0_var(--banner-shadow)] backdrop-blur-md">
          <div className="text-center text-xs font-medium tracking-[0.18em] text-amber-100 uppercase sm:text-sm">
            Under construction: EMWaver is still being finished and some pages or features may be incomplete.
          </div>
        </div>
        {/* Global background (subtle). Landing + Society can override with stronger styling. */}
        <div className="global-bg pointer-events-none fixed inset-0 -z-20">
          <img
            src="/2015_upscale.jpg"
            alt=""
            className="global-bg-image h-full w-full object-cover"
            style={{ opacity: "var(--bg-image-opacity)" }}
          />
          <div className="global-bg-overlay absolute inset-0" style={{ background: "var(--bg-overlay-gradient)" }} />
        </div>

        {children}
      </body>
    </html>
  );
}
