import Link from "next/link";
import styles from "../jobs/jobs.module.css";

const tabs = [
  { href: "/customers", label: "Customers" },
  { href: "/customers/leads", label: "Leads" },
];

export function CustomerTabs({ active }: { active: string }) {
  return (
    <nav className={styles.tabs} aria-label="Customer sections">
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
