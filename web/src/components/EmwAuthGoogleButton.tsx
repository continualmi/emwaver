"use client";

import { GoogleMark } from "@/components/GoogleMark";

type EmwAuthGoogleButtonProps = {
  busy?: boolean;
  disabled?: boolean;
  label?: string;
  busyLabel?: string;
  className?: string;
  onClick?: () => void;
  type?: "button" | "submit";
};

export function EmwAuthGoogleButton({
  busy = false,
  disabled = false,
  label = "Continue with Google",
  busyLabel = "Opening Google...",
  className = "",
  onClick,
  type = "button",
}: EmwAuthGoogleButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      className={`emw-auth-google-button ${busy ? "emw-auth-google-button-busy" : ""} ${className}`.trim()}
      aria-label={busy ? busyLabel : label}
    >
      <GoogleMark className="h-[18px] w-[18px] shrink-0" />
      <span>{busy ? busyLabel : label}</span>
    </button>
  );
}
