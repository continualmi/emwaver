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
    "EMWaver is the future of electronics development — a tiny USB device that turns any phone or laptop into a full-power electronics lab, powered by AI.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${displaySans.variable} ${mono.variable} antialiased`}>
        {/* Global background (subtle). Landing + Society can override with stronger styling. */}
        <div className="global-bg pointer-events-none fixed inset-0 -z-20">
          <img
            src="/2015_upscale.jpg"
            alt=""
            className="global-bg-image h-full w-full object-cover opacity-[0.16]"
          />
          <div className="global-bg-overlay absolute inset-0 bg-[radial-gradient(1000px_600px_at_20%_0%,rgba(78,231,199,0.12),transparent_60%),radial-gradient(900px_600px_at_85%_20%,rgba(91,192,255,0.08),transparent_62%),linear-gradient(to_bottom,rgba(2,3,8,0.88),rgba(2,3,8,0.92))]" />
        </div>

        {children}
      </body>
    </html>
  );
}
