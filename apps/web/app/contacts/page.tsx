import Link from "next/link";
import { Contacts } from "./Contacts";
import styles from "../customers/customerDirectory.module.css";

export const metadata = {
  title: "Contacts | BJH Logistics",
  description: "Phone numbers and emails of leads and customers.",
};

export default function ContactsPage() {
  return (
    <main className={styles.page}>
      <Link className={styles.backLink} href="/">
        <span aria-hidden="true">←</span> Back to overview
      </Link>

      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Contacts</h1>
          <p className={styles.description}>
            The people to call or email at your leads and customers.
          </p>
        </div>
      </header>

      <Contacts />
    </main>
  );
}
