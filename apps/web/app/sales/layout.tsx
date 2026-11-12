import type { ReactNode } from "react";
import { SalesFrame } from "./SalesFrame";

export default function SalesLayout({ children }: { children: ReactNode }) {
  return <SalesFrame>{children}</SalesFrame>;
}
