import type { IconName } from "./content";

const paths: Record<
  | IconName
  | "arrow"
  | "phone"
  | "mail"
  | "pin"
  | "check"
  | "menu"
  | "close"
  | "whatsapp",
  string
> = {
  ship: "M3 17l1.5 3h15L21 17M5 17V11h14v6M8 11V7h8v4M12 3v4M2 21c1.5 0 2-1 3.5-1S7.5 21 9 21s2-1 3.5-1 2 1 3.5 1 2-1 3.5-1 2 1 3.5 1",
  plane:
    "M10.5 21l1.5-3 1.5 3M12 18V14M2 13l10-3 10 3M12 10V4a1.5 1.5 0 013 0v1M12 4a1.5 1.5 0 00-3 0v6",
  truck:
    "M2 6h12v10H2zM14 9h4l3 4v3h-7M6.5 19a2 2 0 100-4 2 2 0 000 4zM17.5 19a2 2 0 100-4 2 2 0 000 4z",
  customs: "M9 12l2 2 4-4M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z",
  warehouse: "M3 21V9l9-6 9 6v12M7 21v-8h10v8M7 17h10",
  door: "M4 21h16M6 21V4h12v17M14 12h.01M9 3v3M15 3v3",
  offshore:
    "M12 3v10M8 7h8M5 13h14l-2 5H7zM2 21c1.5 0 2-1 3.5-1S7.5 21 9 21s2-1 3.5-1 2 1 3.5 1 2-1 3.5-1 2 1 3.5 1",
  shield: "M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z",
  container: "M2 7h20v11H2zM6 7v11M10 7v11M14 7v11M18 7v11",
  license: "M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7M9 8h3",
  project: "M4 20h16M6 20V9l6-5 6 5v11M12 4v16M6 12h12",
  recycle: "M7 19H4l3-5M17 19h3l-3-5M12 4l-2 3.5M12 4l2 3.5M7 19l5-9 5 9z",
  car: "M5 16V11l2-5h10l2 5v5M3 16h18v3H3zM7.5 13h.01M16.5 13h.01",
  globe:
    "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z",
  anchor:
    "M12 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM12 8v13M5 13a7 7 0 0014 0M8 11h8",
  mining: "M4 20l10-10M5 8c4-4 10-4 14-1M13 5l6 6",
  oil: "M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z",
  aid: "M12 21s-8-5-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 6-8 11-8 11zM12 10v5M9.5 12.5h5",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  boxes: "M3 13h8v8H3zM13 13h8v8h-8zM8 3h8v8H8z",
  chat: "M4 5h16v11H9l-5 4z",
  coins:
    "M12 9c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  arrow: "M5 12h14M13 6l6 6-6 6",
  phone:
    "M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z",
  mail: "M3 5h18v14H3zM3 6l9 7 9-7",
  pin: "M12 21s-7-6.5-7-12a7 7 0 0114 0c0 5.5-7 12-7 12zM12 11.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
  check: "M5 12l5 5L20 7",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6L6 18",
  whatsapp:
    "M4 20l1.3-4A8.5 8.5 0 1112 20.5a8.4 8.4 0 01-4-1zM9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 1c-1-.5-2.5-2-3-3l1-1-1-2z",
};

export type AnyIcon = keyof typeof paths;

export function Icon({ name, size = 24 }: { name: AnyIcon; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
