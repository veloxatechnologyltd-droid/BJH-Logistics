import Link from "next/link";
import styles from "../jobs/jobs.module.css";
import finance from "../finance/finance.module.css";

/**
 * Finance is money in (Revenue) and money out (Expenses). Each side has its
 * own pages, shown as a second row of tabs under it.
 */
const sections = [
  { href: "/finance", label: "Overview", pages: [] },
  {
    href: "/invoices",
    label: "Revenue",
    pages: [
      { href: "/invoices", label: "Invoices" },
      { href: "/finance/receipts", label: "Payments received" },
      { href: "/finance/statements", label: "Statements" },
    ],
  },
  {
    href: "/finance/expenses",
    label: "Expenses",
    pages: [
      { href: "/finance/expenses", label: "Business expenses" },
      { href: "/finance/costs", label: "Job costs" },
    ],
  },
];

export function FinanceTabs({ active }: { active: string }) {
  const current = sections.find(
    (section) =>
      section.href === active ||
      section.pages.some((page) => page.href === active),
  );
  return (
    <>
      <nav className={styles.tabs} aria-label="Finance sections">
        {sections.map((section) => {
          const on = section === current;
          return (
            <Link
              aria-current={on && section.href === active ? "page" : undefined}
              className={`${styles.tab}${on ? ` ${styles.tabActive}` : ""}`}
              href={section.href}
              key={section.href}
            >
              {section.label}
            </Link>
          );
        })}
      </nav>
      {current && current.pages.length > 0 && (
        <nav className={finance.subTabs} aria-label={`${current.label} pages`}>
          {current.pages.map((page) => (
            <Link
              aria-current={page.href === active ? "page" : undefined}
              className={`${finance.subTab}${page.href === active ? ` ${finance.subTabActive}` : ""}`}
              href={page.href}
              key={page.href}
            >
              {page.label}
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}
