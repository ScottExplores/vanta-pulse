import type { SVGProps } from "react";

export type IconName =
  | "accessibility"
  | "audio"
  | "audioOff"
  | "back"
  | "burst"
  | "chevron"
  | "close"
  | "cosmetics"
  | "daily"
  | "endless"
  | "leaderboard"
  | "loadout"
  | "lock"
  | "menu"
  | "next"
  | "pause"
  | "play"
  | "prism"
  | "refresh"
  | "retry"
  | "settings"
  | "shell"
  | "spark"
  | "trail";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 24, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {name === "accessibility" && (
        <>
          <circle cx="12" cy="4.25" r="2.15" stroke="currentColor" strokeWidth="1.8" />
          <path d="M4.25 8.25c2.3 1.05 4.88 1.58 7.75 1.58s5.45-.53 7.75-1.58M12 9.9v4.3m0 0-4 6m4-6 4 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </>
      )}
      {name === "audio" && (
        <>
          <path d="M5 9h3l4-3.5v13L8 15H5V9Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
          <path d="M15.2 8.1a5.1 5.1 0 0 1 0 7.8M17.8 5.5a8.75 8.75 0 0 1 0 13" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </>
      )}
      {name === "audioOff" && (
        <>
          <path d="M5 9h3l4-3.5v13L8 15H5V9Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
          <path d="m16 9 5 5m0-5-5 5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </>
      )}
      {name === "back" && <path d="m14.5 5-7 7 7 7" stroke="currentColor" strokeLinecap="square" strokeLinejoin="miter" strokeWidth="2" />}
      {name === "burst" && <path d="m12 2 1.9 5.7L19 5l-2.7 5.1L22 12l-5.7 1.9L19 19l-5.1-2.7L12 22l-1.9-5.7L5 19l2.7-5.1L2 12l5.7-1.9L5 5l5.1 2.7L12 2Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />}
      {name === "chevron" && <path d="m8.5 5 7 7-7 7" stroke="currentColor" strokeLinecap="square" strokeWidth="2" />}
      {name === "close" && <path d="m5 5 14 14M19 5 5 19" stroke="currentColor" strokeLinecap="square" strokeWidth="1.8" />}
      {name === "cosmetics" && <path d="M12 2.5 20 7v10l-8 4.5L4 17V7l8-4.5Zm0 0V12m8-5-8 5m-8-5 8 5" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.65" />}
      {name === "daily" && (
        <>
          <circle cx="12" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="6" cy="16" r="2.5" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="18" cy="16" r="2.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="m10.5 7-3 6.5M13.5 7l3 6.5M8.5 16h7" stroke="currentColor" strokeWidth="1.7" />
        </>
      )}
      {name === "endless" && <path d="M8.2 8.2c-2.4-2.3-5.7-.7-5.7 2.8s3.3 5.1 5.7 2.8L12 10l3.8-3.8c2.4-2.3 5.7-.7 5.7 2.8s-3.3 5.1-5.7 2.8L12 8l-3.8 3.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />}
      {name === "leaderboard" && <path d="M4 19V12h4v7H4Zm6 0V5h4v14h-4Zm6 0V8h4v11h-4Z" fill="currentColor" />}
      {name === "loadout" && <path d="M5 19h14M8 19v-3l4-3 4 3v3M12 13V5m-3 3 3-3 3 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />}
      {name === "lock" && (
        <>
          <rect height="10" rx="1" stroke="currentColor" strokeWidth="1.7" width="14" x="5" y="10" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.7" />
        </>
      )}
      {name === "menu" && <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" />}
      {name === "next" && <path d="m7 4 8 8-8 8m9-16v16" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />}
      {name === "pause" && <path d="M7 4h3v16H7V4Zm7 0h3v16h-3V4Z" fill="currentColor" />}
      {name === "play" && <path d="m7 4 13 8L7 20V4Z" fill="currentColor" />}
      {name === "prism" && <path d="m12 2 6 8-6 12-6-12 6-8Zm0 0v20m6-12H6" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />}
      {name === "refresh" && <path d="M19.5 8.5V4m0 0H15m4.5 0-3.1 3.1A7 7 0 1 0 18 15" stroke="currentColor" strokeLinecap="square" strokeLinejoin="miter" strokeWidth="1.8" />}
      {name === "retry" && <path d="M7.1 7.1A7 7 0 1 1 5 12M3 5v5h5" stroke="currentColor" strokeLinecap="square" strokeLinejoin="miter" strokeWidth="1.8" />}
      {name === "settings" && (
        <>
          <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M9.1 3.5 10 1.8h4l.9 1.7 2 .8 1.8-.5 2 3.5-1.3 1.3.3 2.2 1.3 1.3-2 3.5-1.8-.5-2 .8-.9 1.7h-4l-.9-1.7-2-.8-1.8.5-2-3.5 1.3-1.3-.3-2.2-1.3-1.3 2-3.5 1.8.5 2-.8Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.35" />
        </>
      )}
      {name === "shell" && <path d="m12 2 8 5v10l-8 5-8-5V7l8-5Zm0 4-4.5 2.7v5.6L12 17l4.5-2.7V8.7L12 6Z" fill="currentColor" fillRule="evenodd" />}
      {name === "spark" && <path d="m12 1.5 2.2 7.1 7.3 3.4-7.3 3.4-2.2 7.1-2.2-7.1L2.5 12l7.3-3.4L12 1.5Z" fill="currentColor" />}
      {name === "trail" && <path d="M3 7h11m-8 5h13M3 17h11" stroke="currentColor" strokeLinecap="square" strokeWidth="1.8" />}
    </svg>
  );
}

export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <span className={className ? `vp-verified ${className}` : "vp-verified"} title="Verified runner">
      <svg aria-hidden="true" viewBox="0 0 18 18">
        <path d="m9 1.4 2 1.25 2.35-.1.55 2.3 1.75 1.6-.95 2.15.95 2.15-1.75 1.6-.55 2.3-2.35-.1L9 16.6l-2-1.25-2.35.1-.55-2.3-1.75-1.6.95-2.15-.95-2.15 1.75-1.6.55-2.3 2.35.1L9 1.4Z" fill="currentColor" />
        <path d="m6.1 9 1.8 1.8 4-4" fill="none" stroke="#03040a" strokeLinecap="square" strokeWidth="1.5" />
      </svg>
      <span className="vp-sr-only">Verified runner</span>
    </span>
  );
}
