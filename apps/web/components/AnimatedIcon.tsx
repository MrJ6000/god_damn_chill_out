import type { ReactNode } from "react";

export type IconName =
  | "alert"
  | "arrow-right"
  | "bot"
  | "check"
  | "copy"
  | "home"
  | "minus"
  | "receipt"
  | "reset"
  | "shield"
  | "sparkles"
  | "unlock"
  | "x";

const iconShapes: Record<IconName, ReactNode> = {
  alert: (
    <>
      <path d="M10.3 3.8 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.8a2 2 0 0 0-3.4 0Z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </>
  ),
  "arrow-right": (
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  bot: (
    <>
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <path d="M12 3v4" />
      <path d="M8 12h.01M16 12h.01" />
      <path d="M9 16h6" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  copy: (
    <>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  home: (
    <>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10" />
      <path d="M9 20v-6h6v6" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  receipt: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  reset: (
    <>
      <path d="M4 7v5h5" />
      <path d="M5.7 16.5A8 8 0 1 0 6 6l-2 1" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z" />
      <path d="m8.5 12 2.2 2.2 4.8-5" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 1.2 3.2L16.5 7.5l-3.3 1.3L12 12l-1.2-3.2-3.3-1.3 3.3-1.3L12 3Z" />
      <path d="m18 13 .8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8L18 13Z" />
      <path d="m6 14 .7 1.8 1.8.7-1.8.7L6 19l-.7-1.8-1.8-.7 1.8-.7L6 14Z" />
    </>
  ),
  unlock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 7.5-2" />
      <path d="M12 14v3" />
    </>
  ),
  x: (
    <>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
};

interface AnimatedIconProps {
  active?: boolean;
  className?: string;
  label?: string;
  morphTo?: IconName;
  name: IconName;
}

export function AnimatedIcon({ active = false, className = "h-5 w-5", label, morphTo, name }: AnimatedIconProps) {
  const primaryState = active
    ? "scale-75 -rotate-12 opacity-0"
    : "scale-100 rotate-0 opacity-100 group-hover:scale-75 group-hover:-rotate-12 group-hover:opacity-0";
  const secondaryState = active
    ? "scale-100 rotate-0 opacity-100"
    : "scale-75 rotate-12 opacity-0 group-hover:scale-100 group-hover:rotate-0 group-hover:opacity-100";

  return (
    <svg
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={className}
      fill="none"
      role={label ? "img" : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <g className={`origin-center transition-all duration-200 ease-out motion-reduce:transition-none ${morphTo ? primaryState : ""}`}>
        {iconShapes[name]}
      </g>
      {morphTo ? (
        <g className={`origin-center transition-all duration-200 ease-out motion-reduce:transition-none ${secondaryState}`}>
          {iconShapes[morphTo]}
        </g>
      ) : null}
    </svg>
  );
}
