import type React from "react";

export type NewsPost = {
  slug: string;
  title: string;
  date: string;
  summary: string;
  Content: () => React.JSX.Element;
};

export const NEWS_POSTS: NewsPost[] = [
  {
    slug: "welcome-to-emwaver",
    title: "Welcome to EMWaver",
    date: "2026-02-01",
    summary:
      "What EMWaver is now: one STM32 board, USB-only, scripts + UI as the product.",
    Content: function WelcomeToEmwaverPost() {
      return (
        <>
          <h1>Welcome to EMWaver</h1>
          <p>
            EMWaver is a focused platform for hardware exploration. The product is the app experience:
            scripts render real UI and talk to the device over a stable USB protocol.
          </p>

          <h2>What ships (the platform)</h2>
          <ul>
            <li>One current-gen STM32 board</li>
            <li>USB only (class-compliant USB MIDI SysEx, fixed 64-byte frames)</li>
            <li>One firmware binary for the platform</li>
            <li>Apps on Android / iOS / macOS / Windows</li>
          </ul>

          <h2>The core idea</h2>
          <p>
            EMWaver is about iteration speed: edit a script, run it, and immediately get a new UI and
            workflow. No build/flash loop. No "mode explosion".
          </p>

          <h2>What you do in the app</h2>
          <ol>
            <li>Plug the device in over USB</li>
            <li>Open Scripts</li>
            <li>Run a script (or duplicate and tweak one)</li>
          </ol>

          <h2>Where this blog goes</h2>
          <p>
            We will use News for release notes, platform direction changes, and practical posts that
            help you get from "device plugged in" to "experiment running" fast.
          </p>
        </>
      );
    },
  },
];

export function getNewsPost(slug: string): NewsPost | null {
  return NEWS_POSTS.find((p) => p.slug === slug) ?? null;
}
