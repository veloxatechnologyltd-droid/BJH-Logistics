"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AuthStatus } from "../auth/AuthStatus";
import { useStaffAccess } from "../auth/useStaffAccess";
import { listCustomers } from "../customers/customerApi";
import type { CustomerCompany } from "../customers/customerApi";
import {
  addLocation,
  getStockReport,
  listLocations,
  setLocationActive,
} from "../jobs/jobApi";
import type { StockBalance, WarehouseLocation } from "../jobs/jobApi";
import styles from "../jobs/jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

/** Warehouse locations (staff) and the dated stock report (staff and customers). */
export function WarehouseHome() {
  const { roles, isCustomer } = useStaffAccess();
  const isStaff = roles.length > 0;
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [customers, setCustomers] = useState<CustomerCompany[]>([]);
  const [rows, setRows] = useState<StockBalance[] | null>(null);
  const [asOf, setAsOf] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const loadReport = useCallback(async () => {
    setError("");
    try {
      setRows((await getStockReport(asOf, companyId)).balances);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The report could not be loaded",
      );
    }
  }, [asOf, companyId]);

  const loadLocations = useCallback(async () => {
    try {
      setLocations(await listLocations());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Locations could not be loaded",
      );
    }
  }, []);

  useEffect(() => {
    if (isStaff || isCustomer) void loadReport();
  }, [isStaff, isCustomer, loadReport]);

  useEffect(() => {
    if (!isStaff) return;
    void loadLocations();
    listCustomers("")
      .then(setCustomers)
      .catch(() => undefined);
  }, [isStaff, loadLocations]);

  async function submitLocation(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await addLocation(name.trim());
      setName("");
      setAdding(false);
      await loadLocations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The location failed");
    }
  }

  async function toggle(location: WarehouseLocation) {
    setError("");
    try {
      await setLocationActive(location.id, location.deactivatedAt !== null);
      await loadLocations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The change failed");
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="breadcrumb">
          <Link href="/">Workspace</Link>
          <span aria-hidden="true">/</span>
          <strong>Warehouse</strong>
        </div>
        <AuthStatus />
      </header>
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Warehouse stock</h1>
          </div>
        </header>
        <ErrorPopup message={error} />

        <section className={styles.card} aria-labelledby="report-title">
          <h2 id="report-title">Stock report</h2>
          <div className={styles.actions}>
            <label className={styles.field}>
              As of (leave empty for now)
              <input
                onChange={(event) => setAsOf(event.target.value)}
                type="date"
                value={asOf}
              />
            </label>
            {isStaff && (
              <label className={styles.field}>
                Customer
                <select
                  onChange={(event) => setCompanyId(event.target.value)}
                  value={companyId}
                >
                  <option value="">All customers</option>
                  {customers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.companyName}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {rows && rows.length === 0 && (
            <p className={styles.muted}>No stock held.</p>
          )}
          {rows && rows.length > 0 && (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Job</th>
                    <th>Location</th>
                    <th>Item</th>
                    <th>Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={`${row.jobId}-${row.locationId}-${row.item}-${row.unit}`}
                    >
                      <td>{row.customerCompanyName}</td>
                      <td>
                        <Link
                          className={styles.link}
                          href={`/jobs/${row.jobId}`}
                        >
                          {row.fileNumber}
                        </Link>
                      </td>
                      <td>{row.locationName}</td>
                      <td>{row.item}</td>
                      <td>
                        {row.balance} {row.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {isStaff && (
          <section className={styles.card} aria-labelledby="locations-title">
            <div className={styles.stepsHeading}>
              <h2 id="locations-title">Locations</h2>
              {!adding && (
                <button
                  className={styles.secondaryButton}
                  onClick={() => setAdding(true)}
                  type="button"
                >
                  Add location
                </button>
              )}
            </div>
            {locations.length === 0 ? (
              <p className={styles.muted}>No locations yet.</p>
            ) : (
              <ul className={styles.itemList}>
                {locations.map((location) => (
                  <li key={location.id}>
                    <div>
                      <strong>{location.name}</strong>
                      {location.deactivatedAt && <small>Not in use</small>}
                    </div>
                    <button
                      className={styles.textButton}
                      onClick={() => void toggle(location)}
                      type="button"
                    >
                      {location.deactivatedAt
                        ? "Put back in use"
                        : "Take out of use"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {adding && (
              <form className={styles.form} onSubmit={submitLocation}>
                <label className={styles.field}>
                  New location (for example Bay A1)
                  <input
                    autoFocus
                    maxLength={120}
                    onChange={(event) => setName(event.target.value)}
                    required
                    value={name}
                  />
                </label>
                <div className={styles.formActions}>
                  <button className={styles.button} type="submit">
                    Save
                  </button>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => setAdding(false)}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </section>
        )}
      </main>
    </>
  );
}
