import Link from "next/link";
import { NavIcon } from "../NavIcon";

export default function SettingsPage() {
  return (
    <>
      <main className="dashboard">
        <section className="welcome-row" aria-labelledby="settings-title">
          <div>
            <h1 id="settings-title">Settings</h1>
          </div>
        </section>
        <section className="action-grid" aria-label="Settings pages">
          <article className="action-card">
            <span className="action-icon" aria-hidden="true">
              <NavIcon name="settings" />
            </span>
            <div className="action-copy">
              <h3>Business settings</h3>
            </div>
            <Link className="action-link" href="/settings/business">
              Open settings <span aria-hidden="true">→</span>
            </Link>
          </article>
          <article className="action-card">
            <span className="action-icon" aria-hidden="true">
              <NavIcon name="customers" />
            </span>
            <div className="action-copy">
              <h3>Staff management</h3>
            </div>
            <Link className="action-link" href="/settings/staff">
              Manage staff <span aria-hidden="true">→</span>
            </Link>
          </article>
          <article className="action-card">
            <span className="action-icon" aria-hidden="true">
              <NavIcon name="customers" />
            </span>
            <div className="action-copy">
              <h3>Customer accounts</h3>
            </div>
            <Link className="action-link" href="/settings/customer-accounts">
              Manage customers <span aria-hidden="true">→</span>
            </Link>
          </article>
          <article className="action-card">
            <span className="action-icon" aria-hidden="true">
              <NavIcon name="transport" />
            </span>
            <div className="action-copy">
              <h3>Drivers and vehicles</h3>
            </div>
            <Link className="action-link" href="/transport">
              Manage records <span aria-hidden="true">→</span>
            </Link>
          </article>
          <article className="action-card">
            <span className="action-icon" aria-hidden="true">
              <NavIcon name="messages" />
            </span>
            <div className="action-copy">
              <h3>Customer messages</h3>
            </div>
            <Link className="action-link" href="/settings/notifications">
              View messages <span aria-hidden="true">→</span>
            </Link>
          </article>
          <article className="action-card">
            <span className="action-icon" aria-hidden="true">
              <NavIcon name="quotes" />
            </span>
            <div className="action-copy">
              <h3>Activity log</h3>
            </div>
            <Link className="action-link" href="/settings/activity">
              View activity <span aria-hidden="true">→</span>
            </Link>
          </article>
          <article className="action-card">
            <span className="action-icon" aria-hidden="true">
              <NavIcon name="overview" />
            </span>
            <div className="action-copy">
              <h3>System status</h3>
            </div>
            <Link className="action-link" href="/settings/system-status">
              View status <span aria-hidden="true">→</span>
            </Link>
          </article>
        </section>
      </main>
    </>
  );
}
