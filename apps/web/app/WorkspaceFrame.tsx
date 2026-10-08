"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useStaffAccess } from "./auth/useStaffAccess";
import { NavIcon } from "./NavIcon";
import type { NavIconName } from "./NavIcon";
import { SettingsSidebarSection } from "./SettingsSidebarSection";

type NavItem = {
  href: string;
  label: string;
  icon: NavIconName;
  exact?: boolean;
};

type NavGroup = { heading?: string; items: NavItem[] };

const customerNav: NavGroup[] = [
  {
    items: [
      { href: "/portal", label: "Overview", icon: "overview" },
      { href: "/quotes", label: "Your quotations", icon: "quotes" },
      { href: "/jobs", label: "Your jobs", icon: "jobs" },
      { href: "/warehouse", label: "Your stock", icon: "warehouse" },
      { href: "/documents", label: "Your documents", icon: "documents" },
      { href: "/invoices", label: "Your invoices", icon: "invoices" },
    ],
  },
];

/** Ordered the way the work flows: customer, request, quote, job, money. */
const staffNav: NavGroup[] = [
  {
    items: [{ href: "/", label: "Overview", icon: "overview", exact: true }],
  },
  {
    heading: "SALES",
    items: [
      { href: "/customers", label: "Customers", icon: "customers" },
      { href: "/quotations", label: "Requests", icon: "quotations" },
      { href: "/quotes", label: "Quotes", icon: "quotes" },
    ],
  },
  {
    heading: "OPERATIONS",
    items: [
      { href: "/jobs", label: "Jobs", icon: "jobs" },
      { href: "/tasks", label: "Tasks", icon: "tasks" },
      { href: "/warehouse", label: "Warehouse", icon: "warehouse" },
      { href: "/documents", label: "Documents", icon: "documents" },
    ],
  },
  {
    heading: "FINANCE",
    items: [{ href: "/finance", label: "Finance", icon: "invoices" }],
  },
  {
    heading: "CLIENTS",
    items: [{ href: "/messages", label: "Messages", icon: "messages" }],
  },
];

const collapsedKey = "bjh.sidebar.collapsed";

export function WorkspaceFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isCustomer, status } = useStaffAccess();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(collapsedKey) === "1");
    } catch {
      // Storage can be blocked; the sidebar then simply starts open.
    }
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(collapsedKey, next ? "1" : "0");
    } catch {
      // Not remembered, still works for this visit.
    }
  };
  if (pathname === "/sign-in" || pathname === "/complete-invitation") {
    return children;
  }

  const settingsActive =
    pathname.startsWith("/settings") ||
    pathname.startsWith("/transport") ||
    pathname === "/admin/users";
  const groups = isCustomer ? customerNav : staffNav;

  return (
    <div className={`workspace-shell${collapsed ? " collapsed" : ""}`}>
      <aside className="sidebar">
        <button
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Open sidebar" : "Hide sidebar"}
          className="sidebar-toggle"
          onClick={toggle}
          title={collapsed ? "Open sidebar" : "Hide sidebar"}
          type="button"
        >
          <svg
            aria-hidden="true"
            fill="none"
            height="20"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="20"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <Link className="brand" href="/" aria-label="BJH Logistics overview">
          <span className="brand-mark" aria-hidden="true">
            BJH
          </span>
          <span className="brand-copy">
            <strong>BJH Logistics</strong>
            <small>{isCustomer ? "Customer portal" : "Operations"}</small>
          </span>
        </Link>

        <nav
          className="workspace-nav"
          aria-label={isCustomer ? "Customer portal" : "Staff workspace"}
        >
          {groups.map((group) => (
            <div className="nav-group" key={group.heading ?? "main"}>
              {group.heading && <p className="nav-heading">{group.heading}</p>}
              {group.items.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.href) ||
                    (item.href === "/finance" &&
                      pathname.startsWith("/invoices"));
                return (
                  <Link
                    key={item.href}
                    className={`nav-link${active ? " active" : ""}`}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                  >
                    <NavIcon name={item.icon} />
                    <span className="nav-label">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {!isCustomer && <SettingsSidebarSection active={settingsActive} />}
      </aside>

      <div className="workspace-main">
        {status === "unavailable" && (
          <p className="access-notice" role="alert">
            Your access could not be checked, so some buttons may be missing.
            <button onClick={() => window.location.reload()} type="button">
              Reload
            </button>
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
