import Link from "next/link";
import styles from "../jobs/jobs.module.css";

const tabs = [
  { href: "/performance", label: "Team performance" },
  { href: "/performance/reports", label: "Daily & weekly reports" },
];

export function PerformanceTabs({ active }: { active: string }) {
  return (
    <nav className={styles.tabs} aria-label="Performance sections">
      {tabs.map((tab) => (
        <Link
          aria-current={tab.href === active ? "page" : undefined}
          className={`${styles.tab}${tab.href === active ? ` ${styles.tabActive}` : ""}`}
          href={tab.href}
          key={tab.href}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
