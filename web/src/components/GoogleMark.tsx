"use client";

type GoogleMarkProps = {
  className?: string;
};

export function GoogleMark({ className = "h-4 w-4" }: GoogleMarkProps) {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className={className}>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.18-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.69-3.88 2.69-6.62Z" />
      <path fill="#34A853" d="M9 18a8.77 8.77 0 0 0 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC04" d="M3.97 10.71A5.41 5.41 0 0 1 3.69 9c0-.6.1-1.18.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.28 0 2.43.44 3.33 1.3l2.5-2.5C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}
