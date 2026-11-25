import { LeadsBoard } from "./LeadsBoard";
import styles from "../customerDirectory.module.css";

export const metadata = {
  title: "Leads | BJH Logistics",
  description: "Track prospects from first contact to customer.",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const { search } = await searchParams;
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Leads</h1>
        </div>
      </header>

      <LeadsBoard initialSearch={search} />
    </main>
  );
}
