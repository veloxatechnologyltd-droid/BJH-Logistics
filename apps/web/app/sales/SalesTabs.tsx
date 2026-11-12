"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DRAFTS_CHANGED, listDrafts } from "./salesApi";
import styles from "./sales.module.css";

const tabs = [
  { href: "/sales", label: "Overview", exact: true },
  { href: "/sales/pool", label: "Lead pool" },
  { href: "/sales/pipeline", label: "Pipeline" },
  { href: "/sales/approvals", label: "Approvals", badge: true },
  { href: "/campaigns", label: "Campaigns" },
];

/** The sections of the sales hub; Approvals shows how many emails wait for a decision. */
export function SalesTabs() {
  const pathname = usePathname();
  const [waiting, setWaiting] = useState(0);

  const refresh = useCallback(() => {
    listDrafts("pending", 1)
      .then((page) => setWaiting(page.counts.pending))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(DRAFTS_CHANGED, refresh);
    return () => window.removeEventListener(DRAFTS_CHANGED, refresh);
  }, [refresh]);

  return (
    <nav className={styles.tabsBar} aria-label="Sales sections">
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`${styles.tabLink}${active ? ` ${styles.tabLinkActive}` : ""}`}
            href={tab.href}
            key={tab.href}
          >
            {tab.label}
            {tab.badge && waiting > 0 && (
              <span
                className={styles.tabCount}
                aria-label={`${waiting} waiting for approval`}
              >
                {waiting}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
