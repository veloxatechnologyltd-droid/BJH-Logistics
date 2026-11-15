import Link from "next/link";
import styles from "../jobs/jobs.module.css";

const tabs = [
  { href: "/quotations", label: "Quote mail" },
  { href: "/inquiries", label: "Inquiries mail" },
];

export function InquiryTabs({ active }: { active: string }) {
  return (
    <nav className={styles.tabs} aria-label="Mailbox">
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
