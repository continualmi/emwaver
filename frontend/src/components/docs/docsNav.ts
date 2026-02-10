export type DocsNavItem = {
  href: string;
  label: string;
  description?: string;
};

export type DocsNavGroup = {
  heading: string;
  items: DocsNavItem[];
};

export const DOCS_NAV: DocsNavGroup[] = [
  {
    heading: "Getting Started",
    items: [
      {
        href: "/docs",
        label: "Overview",
        description: "What EMWaver is and how to start.",
      },
      {
        href: "/docs/install",
        label: "Install & connect",
        description: "Get the apps and connect to your device.",
      },
    ],
  },
  {
    heading: "Scripts",
    items: [
      {
        href: "/docs/scripts",
        label: "Run scripts",
        description: "UI + device APIs in one file.",
      },
    ],
  },
  {
    heading: "Troubleshooting",
    items: [
      {
        href: "/docs/device-recovery",
        label: "Recover device identity",
        description: "Fix “Not secure” after an update.",
      },
    ],
  },
  {
    heading: "Headless",
    items: [
      {
        href: "/docs/daemon",
        label: "EMWaver Daemon",
        description: "Run scripts as a background service.",
      },
    ],
  },
  {
    heading: "Hardware",
    items: [
      {
        href: "/docs/hardware/device",
        label: "Current board",
        description: "What ships today and why.",
      },
      {
        href: "/docs/hardware/pinout",
        label: "Pinout",
        description: "Headers, GPIO numbering, key pins.",
      },
    ],
  },
];
