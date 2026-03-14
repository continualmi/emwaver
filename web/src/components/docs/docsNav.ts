export type DocsNavItem = {
  href: string;
  label: string;
  iconPath: string;
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
        iconPath: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z",
      },
      {
        href: "/docs/install",
        label: "Install & connect",
        iconPath: "M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3",
      },
    ],
  },
  {
    heading: "Scripts",
    items: [
      {
        href: "/docs/scripts",
        label: "Run scripts",
        iconPath: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
      },
    ],
  },
  {
    heading: "Headless",
    items: [
      {
        href: "/docs/daemon",
        label: "EMWaver Daemon",
        iconPath: "M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-7-4h.01M17 16h.01",
      },
    ],
  },
  {
    heading: "Hardware",
    items: [
      {
        href: "/docs/hardware/device",
        label: "Supported boards",
        iconPath: "M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zm4-10h.01M12 13h.01",
      },
      {
        href: "/docs/hardware/pinout",
        label: "Pinout",
        iconPath: "M13 10V3L4 14h7v7l9-11h-7z",
      },
    ],
  },
];
