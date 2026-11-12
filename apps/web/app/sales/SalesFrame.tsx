"use client";

import type { ReactNode } from "react";
import { useStaffAccess } from "../auth/useStaffAccess";
import { canUseLeadGeneration } from "../auth/roleAccess";
import { SalesTabs } from "./SalesTabs";
import styles from "./sales.module.css";

/**
 * The sales hub's page: title, sections and the access rule (sales, customer service
 * and the super admin, as in the API). Used by every page of the hub, Campaigns included.
 */
export function SalesFrame({ children }: { children: ReactNode }) {
  const { status, roles } = useStaffAccess();
  if (status === "loading") return null;
  if (!canUseLeadGeneration(roles)) {
    return (
      <main className={styles.hub}>
        <h1 className={styles.hubTitle}>Sales</h1>
        <p className={styles.hubLead}>
          The sales workspace is for sales, customer service and the super
          admin. Ask your administrator if you need it.
        </p>
      </main>
    );
  }
  return (
    <main className={styles.hub}>
      <header className={styles.hubHeader}>
        <div>
          <h1 className={styles.hubTitle}>Sales</h1>
          <p className={styles.hubLead}>
            Find businesses to sell to, approve the emails written for them, and
            follow each one until it becomes a customer.
          </p>
        </div>
      </header>
      <SalesTabs />
      {children}
    </main>
  );
}
