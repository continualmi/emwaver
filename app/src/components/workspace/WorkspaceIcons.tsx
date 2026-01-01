export function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      className={className ?? "h-4 w-4"}
      aria-hidden="true"
    >
      <path d="M2.5 3.5h11v9h-11z" />
      <path d="M4.6 6.1l2 1.9-2 1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.6 10.1h3.6" strokeLinecap="round" />
    </svg>
  );
}

export function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={className ?? "h-4 w-4"}>
      <path d="M8 3.3v9.4M3.3 8h9.4" strokeLinecap="round" />
    </svg>
  );
}

export function MinusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={className ?? "h-4 w-4"}>
      <path d="M3.3 8h9.4" strokeLinecap="round" />
    </svg>
  );
}

export function TrashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={className ?? "h-4 w-4"}>
      <path d="M5.4 5.4v7M8 5.4v7M10.6 5.4v7" strokeLinecap="round" />
      <path d="M3.6 4.3h8.8" strokeLinecap="round" />
      <path d="M6.1 4.3l.7-1.4h2.4l.7 1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 4.3l.5 9.2h6l.5-9.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={className ?? "h-4 w-4"}>
      <path d="M4.2 6.2l3.8 3.8 3.8-3.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={className ?? "h-4 w-4"}>
      <path d="M6.2 4.2l3.8 3.8-3.8 3.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={className ?? "h-4 w-4"}>
      <path d="M4.3 4.3l7.4 7.4M11.7 4.3l-7.4 7.4" strokeLinecap="round" />
    </svg>
  );
}

export function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className ?? "h-4 w-4"} aria-hidden="true">
      <path d="M5.2 3.6a.8.8 0 011.2-.7l6.2 3.6a.8.8 0 010 1.4l-6.2 3.6a.8.8 0 01-1.2-.7V3.6z" />
    </svg>
  );
}

export function UploadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={className ?? "h-4 w-4"}>
      <path d="M8 9.2V3.6" strokeLinecap="round" />
      <path d="M5.4 6.2L8 3.6l2.6 2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 9.6v2.2c0 .6.4 1 1 1h7c.6 0 1-.4 1-1V9.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HammerIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      className={className ?? "h-4 w-4"}
      aria-hidden="true"
    >
      <path d="M9.6 2.6l3.8 3.8-1.3 1.3-3.8-3.8z" strokeLinejoin="round" />
      <path d="M7.6 4.6l3.8 3.8" strokeLinecap="round" />
      <path
        d="M6.8 6.3L3 10.1c-.5.5-.5 1.3 0 1.8l1.1 1.1c.5.5 1.3.5 1.8 0l3.8-3.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6.2 3.9l1.7-1.7 2.2 2.2-1.7 1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MonitorIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      className={className ?? "h-4 w-4"}
      aria-hidden="true"
    >
      <path d="M3 3.5h10c.6 0 1 .4 1 1v6.2c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V4.5c0-.6.4-1 1-1z" strokeLinejoin="round" />
      <path d="M6.2 13.5h3.6" strokeLinecap="round" />
      <path d="M8 11.7v1.8" strokeLinecap="round" />
    </svg>
  );
}

export function PanelLeftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={className ?? "h-4 w-4"}>
      <path d="M2.5 3.5h11v9h-11z" />
      <path d="M6 3.5v9" strokeLinecap="round" />
    </svg>
  );
}

export function FolderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={className ?? "h-4 w-4"}>
      <path
        d="M2.6 4.6c0-.6.4-1 1-1h3l1.1 1.1H12.4c.6 0 1 .4 1 1v6.6c0 .6-.4 1-1 1H3.6c-.6 0-1-.4-1-1z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function GitIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      className={className ?? "h-4 w-4"}
      aria-hidden="true"
    >
      <path d="M5.2 4.2a2 2 0 104 0 2 2 0 00-4 0z" />
      <path d="M6.2 6.1v3.8a2 2 0 101.6 0V6.1" strokeLinecap="round" />
      <path d="M8 10.9h2.6a2 2 0 101.4-3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={className ?? "h-4 w-4"}>
      <path d="M13.2 7.1A5.4 5.4 0 103 12.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.8 3.4v3.8H9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowUpIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={className ?? "h-4 w-4"}>
      <path d="M8 12.7V3.7" strokeLinecap="round" />
      <path d="M4.7 6.9L8 3.6l3.3 3.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

