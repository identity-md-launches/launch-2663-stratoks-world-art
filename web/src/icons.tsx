import type { CSSProperties } from "react";
export type IconName =
  | "world"
  | "people"
  | "history"
  | "leaf"
  | "home"
  | "heart"
  | "settings"
  | "help"
  | "close"
  | "plus"
  | "minus"
  | "center"
  | "arrow"
  | "chevron"
  | "play"
  | "pause"
  | "spark"
  | "signal"
  | "fire"
  | "storm"
  | "shield"
  | "check"
  | "eye"
  | "search"
  | "download"
  | "wallet"
  | "sun"
  | "clock"
  | "link";
const paths: Record<IconName, React.ReactNode> = {
  world: (
    <>
      <path d="m3 8 9-5 9 5-9 5zM3 12l9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 20v-3a6 6 0 0 0-3-5" />
    </>
  ),
  history: (
    <>
      <path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2" />
    </>
  ),
  leaf: (
    <>
      <path d="M20 3c0 13-4 17-10 17C-1 19 1 5 20 3ZM5 20l9-10" />
    </>
  ),
  home: (
    <>
      <path d="m3 10 9-7 9 7M5 9v12h14V9M10 21v-7h4v7" />
    </>
  ),
  heart: (
    <path d="M20.5 5a5 5 0 0 0-8.5 2A5 5 0 0 0 3.5 5C-1 10 6 16 12 21c6-5 13-11 8.5-16Z" />
  ),
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="8" cy="7" r="3" />
      <circle cx="16" cy="17" r="3" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9a3 3 0 1 1 4 3c-1 0-1 1-1 2M12 17h.01" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  center: (
    <>
      <path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  play: <path d="m8 4 12 8-12 8z" />,
  pause: (
    <>
      <path d="M8 5v14M16 5v14" />
    </>
  ),
  spark: (
    <>
      <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z" />
    </>
  ),
  signal: (
    <>
      <path d="M5 19v-4M12 19V9M19 19V3" />
    </>
  ),
  fire: (
    <path d="M12 2c1 6 7 6 7 12a7 7 0 0 1-14 0c0-3 2-5 3-7 0 4 2 4 2 3 2-3 2-6 2-8Z" />
  ),
  storm: (
    <>
      <path d="M7 15a5 5 0 1 1 0-10 6 6 0 0 1 11 3 4 4 0 0 1 0 8M13 12l-4 6h5l-3 5" />
    </>
  ),
  shield: <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" />,
  check: <path d="m4 12 5 5L20 6" />,
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
    </>
  ),
  wallet: (
    <>
      <path d="M20 8V4H5a2 2 0 0 0 0 4h16v12H5a2 2 0 0 1-2-2V6M21 12h-5v4h5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 1v2M12 21v2M1 12h2M21 12h2M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  link: (
    <>
      <path d="m9 15 6-6M14 5l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0M10 19l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0" />
    </>
  ),
};
export function Icon({
  name,
  size = 20,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
export function Mascot({
  size = 48,
  mood = "happy",
}: {
  size?: number;
  mood?: string;
}) {
  return (
    <svg width={size} height={size} aria-hidden="true" viewBox="0 0 64 64">
      <ellipse cx="32" cy="56" rx="20" ry="5" fill="#203e251a" />
      <path
        d="M21 49v8m22-8v8"
        stroke="#b99032"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path d="M16 28c0-17 32-17 32 0v15c0 19-32 19-32 0Z" fill="#f0cc57" />
      <path
        d="M20 30c0-14 23-16 25-5-9-3-15 3-15 22-8-1-10-8-10-17"
        fill="#fce48a"
      />
      <path
        d="M25 16c-3-8-8-9-9-6m23 6c3-8 8-9 9-6"
        stroke="#f0cc57"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="m16 33-5 9m37-9 5 9"
        stroke="#e2b846"
        strokeWidth="5"
        strokeLinecap="round"
      />
      {mood === "rest" ? (
        <path
          d="M22 32h5m10 0h5"
          stroke="#3b442e"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      ) : (
        <>
          <ellipse cx="25" cy="31" rx="2.3" ry="3.2" fill="#3b442e" />
          <ellipse cx="39" cy="31" rx="2.3" ry="3.2" fill="#3b442e" />
        </>
      )}
      <path
        d="M28 39q4 4 8 0"
        stroke="#6f6531"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <ellipse cx="21" cy="37" rx="3" ry="1.5" fill="#df9e62" />
      <ellipse cx="43" cy="37" rx="3" ry="1.5" fill="#df9e62" />
    </svg>
  );
}
