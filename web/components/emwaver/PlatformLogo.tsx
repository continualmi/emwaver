export type PlatformLogoName = "apple" | "android" | "windows" | "linux";

export function PlatformLogo({ name, className = "h-7 w-7" }: { name: PlatformLogoName; className?: string }) {
  if (name === "apple") {
    return (
      <svg className={className} viewBox="0 0 814 1000" fill="currentColor" aria-hidden="true">
        <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
      </svg>
    );
  }

  if (name === "windows") {
    return (
      <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
        <path fill="#00A4EF" d="M4 9.7 29.2 6v24.3H4V9.7Z" />
        <path fill="#00A4EF" d="M32.8 5.5 60 1.5v28.8H32.8V5.5Z" />
        <path fill="#00A4EF" d="M4 33.7h25.2V58L4 54.3V33.7Z" />
        <path fill="#00A4EF" d="M32.8 33.7H60v28.8l-27.2-4V33.7Z" />
      </svg>
    );
  }

  if (name === "linux") {
    return (
      <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
        <path fill="#F5C542" d="M31.8 6.5c-9.7 0-17.1 8.6-17.1 20.6 0 5.4-1.8 9.2-4.1 13.2-1.6 2.9-3.5 6.2-4.6 10.7 5.2 3.8 12.3 6.5 20.2 7.2l3.3-5.1h5l3.4 5.1c7.9-.8 14.9-3.4 20.1-7.2-1.1-4.5-3-7.8-4.6-10.7-2.3-4-4.1-7.8-4.1-13.2 0-12-7.6-20.6-17.5-20.6Z" />
        <path fill="#111827" d="M31.9 9.8c-8 0-14 7.4-14 17.3 0 6.2-2.2 10.5-4.5 14.6-1.2 2.1-2.4 4.3-3.4 6.9 4.4 2.9 10.3 5 16.7 5.8l2.9-4.4h4.8l2.9 4.4c6.4-.8 12.2-2.9 16.6-5.8-1-2.6-2.2-4.8-3.4-6.9-2.3-4.1-4.5-8.4-4.5-14.6 0-9.9-6.1-17.3-14.1-17.3Z" />
        <ellipse cx="32" cy="38.5" rx="11.4" ry="13.9" fill="#F8FAFC" />
        <circle cx="26.4" cy="24.6" r="3" fill="#F8FAFC" />
        <circle cx="37.6" cy="24.6" r="3" fill="#F8FAFC" />
        <circle cx="26.9" cy="25" r="1.2" fill="#111827" />
        <circle cx="37.1" cy="25" r="1.2" fill="#111827" />
        <path fill="#F5C542" d="M26.9 31c2.9-2.3 7.3-2.3 10.2 0L32 35.3 26.9 31Z" />
        <path fill="#F5C542" d="M19.5 55.8c2.4-3.4 7.8-3.8 10.8-.9-2.8 4.3-8.6 4.8-13.4 3.8.7-1.1 1.5-2 2.6-2.9Zm25 0c-2.4-3.4-7.8-3.8-10.8-.9 2.8 4.3 8.6 4.8 13.4 3.8-.7-1.1-1.5-2-2.6-2.9Z" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <path fill="#3DDC84" d="M18 24h28v20c0 3.3-2.7 6-6 6H24c-3.3 0-6-2.7-6-6V24Z" />
      <path stroke="#3DDC84" strokeWidth="4" strokeLinecap="round" d="M14 27v13m36-13v13M23 15l-5-7m23 7 5-7" />
      <path fill="#3DDC84" d="M20 22c1.7-7.1 6.2-11 12-11s10.3 3.9 12 11H20Z" />
      <circle cx="27" cy="18" r="1.7" fill="#fff" />
      <circle cx="37" cy="18" r="1.7" fill="#fff" />
    </svg>
  );
}
