import Link from "next/link";
import styles from "../jobs/jobs.module.css";

const tabs = [
  { href: "/finance", label: "Overview" },
  { href: "/invoices", label: "Invoices" },
];

export function FinanceTabs({ active }: { active: string }) {
  return (
    <nav className={styles.tabs} aria-label="Finance sections">
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
