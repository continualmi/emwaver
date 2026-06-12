import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/emwaver/SiteHeader";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy policy for the EMWaver app and public website.",
};

const lastUpdated = "June 12, 2026";

function PolicySection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)]">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-7 text-[color:var(--ink-dim)]">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="docs-mode min-h-dvh">
      <SiteHeader />

      <main className="mx-auto max-w-4xl px-5 py-14">
        <article className="rounded-3xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-6 md:p-10">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--sky)]">
            EMWaver app
          </div>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-8 text-[color:var(--ink-dim)]">
            EMWaver is built to be local-first. Core hardware control, scripts, and device workflows
            run on your device and do not require an EMWaver account, cloud activation, hosted relay,
            or subscription.
          </p>
          <p className="mt-4 text-sm text-[color:var(--ink-dim)]">Last updated: {lastUpdated}</p>

          <PolicySection title="Who We Are">
            <p>
              EMWaver is an open-source electronics app and website by Continual MI. This policy
              covers the EMWaver native apps and the public website at{" "}
              <a
                href="https://emwaver.ai"
                className="text-[color:var(--sky)] underline decoration-[color:var(--link-underline)] hover:decoration-[color:var(--link-underline-hover)]"
              >
                emwaver.ai
              </a>
              .
            </p>
          </PolicySection>

          <PolicySection title="Information EMWaver Handles Locally">
            <p>
              The EMWaver apps may store scripts, script drafts, imported files, settings, console
              output, device labels, connection status, firmware-update status, and captured hardware
              signals on your device. This local information is used to run scripts, render app UI,
              connect to supported boards, and help you continue local hardware work.
            </p>
            <p>
              If you provision Wi-Fi for a supported ESP32-class board, the app sends the SSID and
              password you enter to that board over the selected local transport. On platforms that
              offer secure local storage, EMWaver may use that storage for convenience, such as saving
              a Wi-Fi password locally on your device. EMWaver does not send Wi-Fi credentials to a
              Continual MI server.
            </p>
          </PolicySection>

          <PolicySection title="Permissions">
            <p>
              EMWaver requests device permissions only to support local hardware workflows. Bluetooth
              is used to discover and connect to nearby supported boards. Local network and Bonjour
              access are used to discover and connect to supported boards on your LAN. USB access is
              used to communicate with supported boards and firmware-update modes.
            </p>
            <p>
              On Android, location permission may be requested because Android ties Bluetooth scanning
              to location-related permissions on some versions. EMWaver uses that permission for
              nearby-device discovery, not to collect or track your physical location. Storage or file
              permissions may be used to import, export, or manage local scripts and related files.
              Notification permission may be used for app or device-status notifications where the
              platform requires it.
            </p>
          </PolicySection>

          <PolicySection title="Network Use">
            <p>
              Core hardware control does not require an EMWaver account or cloud service. The apps may
              use the network when you open documentation, download app or firmware-related resources,
              check the macOS update feed, connect to a supported board on your local network, or open
              external community and source-code links.
            </p>
            <p>
              Desktop EMWaver apps may expose an optional local MCP endpoint on your own machine when
              you enable it. That endpoint is intended for local clients and is controlled by your app
              settings.
            </p>
          </PolicySection>

          <PolicySection title="What We Do Not Do">
            <ul className="list-disc space-y-2 pl-5">
              <li>We do not require an EMWaver account for core local hardware control.</li>
              <li>We do not sell personal information.</li>
              <li>We do not use local hardware access for advertising profiles.</li>
              <li>We do not use hosted device activation, ownership checks, or subscription gates for local control.</li>
              <li>We do not store your local scripts in an EMWaver cloud service by default.</li>
            </ul>
          </PolicySection>

          <PolicySection title="Third-Party Services">
            <p>
              EMWaver may link to third-party services such as Apple App Store, Google Play, GitHub,
              Discord, and Continual MI web properties. Those services have their own privacy
              practices. The public website may also produce ordinary hosting and security logs, such
              as IP address, user agent, requested URL, and request time, as part of operating the site.
            </p>
          </PolicySection>

          <PolicySection title="Retention and Deletion">
            <p>
              Local scripts, settings, console output, signals, and device workflow data remain on
              your device until you delete them through the app, remove local files, clear app data, or
              uninstall the app. Operating-system backups may include app-local data depending on your
              device and backup settings.
            </p>
          </PolicySection>

          <PolicySection title="Children">
            <p>
              EMWaver is a technical electronics tool and is not directed to children under 13. We do
              not knowingly collect personal information from children through the EMWaver app.
            </p>
          </PolicySection>

          <PolicySection title="Changes">
            <p>
              We may update this policy as EMWaver changes. When we do, we will update the date at the
              top of this page.
            </p>
          </PolicySection>

          <PolicySection title="Contact">
            <p>
              For privacy questions, contact Continual MI through the{" "}
              <Link
                href="/support"
                className="text-[color:var(--sky)] underline decoration-[color:var(--link-underline)] hover:decoration-[color:var(--link-underline-hover)]"
              >
                EMWaver support page
              </Link>
              .
            </p>
          </PolicySection>
        </article>
      </main>
    </div>
  );
}
