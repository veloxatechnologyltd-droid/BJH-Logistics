import Link from "next/link";
import { Contacts } from "./Contacts";
import styles from "../customers/customerDirectory.module.css";

export const metadata = {
  title: "Address book | BJH Logistics",
  description: "Every customer and lead, with phone, email and source.",
};

export default function ContactsPage() {
  return (
    <main className={styles.page}>
      <Link className={styles.backLink} href="/">
        <span aria-hidden="true">←</span> Back to overview
      </Link>

      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Address book</h1>
          <p className={styles.description}>
            Every customer and lead in one list, with where each came from.
          </p>
        </div>
      </header>

      <Contacts />
    </main>
  );
}
