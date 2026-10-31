"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AuthStatus } from "./auth/AuthStatus";
import { useStaffAccess } from "./auth/useStaffAccess";
import { NavIcon } from "./NavIcon";
import type { NavIconName } from "./NavIcon";
import { SettingsSidebarSection } from "./SettingsSidebarSection";
import { listQuoteRequests } from "./quotations/quoteRequestApi";

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
      {
        href: "/shipping-documents",
        label: "Shipping documents",
        icon: "shipping",
      },
      { href: "/reports", label: "Reports", icon: "invoices" },
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
const newRequestsEveryMs = 60_000;

/** Emailed requests nobody has checked yet: the inbox's "Needs checking". */
function useNewRequestCount(enabled: boolean, pathname: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const load = () =>
      listQuoteRequests()
        .then((requests) => {
          if (current) {
            setCount(
              requests.filter(
                (request) => request.intake && !request.intake.reviewedAt,
              ).length,
            );
          }
        })
        // The badge is a hint; the Requests page shows any failure.
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, newRequestsEveryMs);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [enabled, pathname]);
  return enabled ? count : 0;
}

/** Pages reached from Settings or a link, not from the main menu. */
const settingsPages: Array<{ href: string; label: string }> = [
  { href: "/settings/business", label: "Business settings" },
  { href: "/settings/staff", label: "Staff management" },
  { href: "/settings/customer-accounts", label: "Customer accounts" },
  { href: "/settings/notifications", label: "Customer messages" },
  { href: "/settings/activity", label: "Activity log" },
  { href: "/settings/system-status", label: "System status" },
  { href: "/admin/users", label: "Staff management" },
  { href: "/transport", label: "Transport" },
];

const matches = (pathname: string, href: string, exact?: boolean) =>
  exact || href === "/"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

/** The page's place in the workspace, from the menu it was reached by. */
function pageCrumb(
  pathname: string,
  groups: NavGroup[],
  isCustomer: boolean,
): { label: string; underSettings: boolean } {
  const setting = settingsPages.find((page) => matches(pathname, page.href));
  if (setting) return { label: setting.label, underSettings: true };
  if (matches(pathname, "/settings")) {
    return { label: "Settings", underSettings: false };
  }
  // Staff reach invoices from the Finance menu (its Invoices tab).
  if (!isCustomer && matches(pathname, "/invoices")) {
    return { label: "Finance", underSettings: false };
  }
  const item = groups
    .flatMap((group) => group.items)
    .filter((entry) => matches(pathname, entry.href, entry.exact))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return { label: item?.label ?? "Overview", underSettings: false };
}

export function WorkspaceFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isCustomer, status, mustChangePassword, twoFactorRequired } =
    useStaffAccess();
  const [collapsed, setCollapsed] = useState(false);
  const newRequests = useNewRequestCount(
    status === "ready" && !isCustomer,
    pathname,
  );

  // A new password, then the super admin's second step, come before any page.
  useEffect(() => {
    if (mustChangePassword && pathname !== "/set-password") {
      router.replace("/set-password");
    } else if (
      !mustChangePassword &&
      twoFactorRequired &&
      pathname !== "/two-factor"
    ) {
      router.replace("/two-factor");
    }
  }, [mustChangePassword, twoFactorRequired, pathname, router]);

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
  if (
    pathname === "/sign-in" ||
    pathname === "/complete-invitation" ||
    pathname === "/set-password" ||
    pathname === "/two-factor"
  ) {
    return children;
  }

  const settingsActive =
    pathname.startsWith("/settings") ||
    pathname.startsWith("/transport") ||
    pathname === "/admin/users";
  // Until the access check answers we do not know whose menu this is. Showing
  // the staff one meanwhile made customers see it flash on every refresh.
  const resolving = status === "loading";
  const groups = isCustomer ? customerNav : staffNav;
  const crumb = pageCrumb(pathname, groups, isCustomer);

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
            <small>
              {resolving ? "" : isCustomer ? "Customer portal" : "Operations"}
            </small>
          </span>
        </Link>

        <nav
          className="workspace-nav"
          aria-label={isCustomer ? "Customer portal" : "Staff workspace"}
          aria-busy={resolving}
        >
          {(resolving ? [] : groups).map((group) => (
            <div className="nav-group" key={group.heading ?? "main"}>
              {group.heading && <p className="nav-heading">{group.heading}</p>}
              {group.items.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.href) ||
                    (item.href === "/finance" &&
                      pathname.startsWith("/invoices"));
                const badge = item.href === "/quotations" ? newRequests : 0;
                const label = badge
                  ? `${item.label}, ${badge} new`
                  : item.label;
                return (
                  <Link
                    key={item.href}
                    className={`nav-link${active ? " active" : ""}`}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    aria-label={badge ? label : undefined}
                    title={collapsed ? label : undefined}
                  >
                    <NavIcon name={item.icon} />
                    <span className="nav-label">{item.label}</span>
                    {badge > 0 && (
                      <span className="nav-badge" aria-hidden="true">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {!resolving && !isCustomer && (
          <SettingsSidebarSection active={settingsActive} />
        )}
      </aside>

      <div className="workspace-main">
        {/* One header on every page: where you are, who is signed in, sign out. */}
        <header className="topbar">
          <div className="breadcrumb">
            {!resolving && (
              <>
                <Link href={isCustomer ? "/portal" : "/"}>
                  {isCustomer ? "Portal" : "Workspace"}
                </Link>
                <span aria-hidden="true">/</span>
                {crumb.underSettings && (
                  <>
                    <Link href="/settings">Settings</Link>
                    <span aria-hidden="true">/</span>
                  </>
                )}
                <strong>{crumb.label}</strong>
              </>
            )}
          </div>
          <div className="topbar-actions">
            <AuthStatus />
          </div>
        </header>
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
