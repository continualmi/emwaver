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
        label: "Install",
        iconPath: "M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3",
      },
    ],
  },
  {
    heading: "Scripts",
    items: [
      {
        href: "/docs/scripts",
        label: "Scripting guide",
        iconPath: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
      },
      {
        href: "/docs/scripts/device-api",
        label: "Device API",
        iconPath: "M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zm4-10h.01M12 13h.01",
      },
      {
        href: "/docs/scripts/ui",
        label: "UI widgets",
        iconPath: "M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 8a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zm10 0a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z",
      },
    ],
  },
  {
    heading: "Hardware",
    items: [
      {
        href: "/docs/hardware",
        label: "Boards & repos",
        iconPath: "M13 10V3L4 14h7v7l9-11h-7z",
      },
      {
        href: "/docs/hardware/pinout",
        label: "Pinout",
        iconPath: "M12 18v-3m0-3v.01M12 8V3m-4.5 3.5L9 5m6 1.5L13.5 5M7 21h10a2 2 0 002-2v-5a7 7 0 00-14 0v5a2 2 0 002 2z",
      },
    ],
  },
  {
    heading: "Tutorials",
    items: [
      {
        href: "/docs/tutorials",
        label: "Overview",
        iconPath: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
      },
      {
        href: "/docs/tutorials/windows-flashing",
        label: "Windows ESP32 flashing",
        iconPath: "M13 10V3L4 14h7v7l9-11h-7z",
      },
      {
        href: "/docs/tutorials/windows-cc1101",
        label: "Windows CC1101 (433 MHz)",
        iconPath: "M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c2.734-2.22 6.88-2.22 9.615 0M3.515 9.515c4.686-4.686 12.284-4.686 16.97 0",
      },
    ],
  },
  {
    heading: "Community",
    items: [
      {
        href: "/docs/community",
        label: "Get help",
        iconPath: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-4l-4 4v-4z",
      },
    ],
  },
];
