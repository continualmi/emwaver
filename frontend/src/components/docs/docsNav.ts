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
        description: "Get the apps and connect over USB.",
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
