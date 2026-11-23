"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AuthStatus } from "./auth/AuthStatus";
import { useStaffAccess } from "./auth/useStaffAccess";
import { InstallPrompt } from "./install/InstallPrompt";
import { NavIcon } from "./NavIcon";
import type { NavIconName } from "./NavIcon";
import { SettingsSidebarSection } from "./SettingsSidebarSection";
import { StaffNotices } from "./StaffNotices";
import { SupportButton } from "./support/SupportButton";
import { getTeamUnread } from "./team-chat/teamChatApi";
import { PushPrompt } from "./push/PushPrompt";
import { pollWhileVisible } from "./pollWhileVisible";
import { getWorkspaceBadges } from "./workspaceApi";
import type { WorkspaceBadges } from "./workspaceApi";
import { newPopupState, syncPopups } from "./team-chat/teamNotifications";
import type { PopupState } from "./team-chat/teamNotifications";

type NavItem = {
  href: string;
  label: string;
  icon: NavIconName;
  exact?: boolean;
  /** Other pages that belong under this item, so it stays highlighted on them. */
  alsoMatches?: string[];
  /** Only these staff roles see the item; everyone when absent. */
  roles?: string[];
  /** Shown only where the CRM is switched on for this person (CRM_ACCESS on the API). */
  crm?: boolean;
};

type NavGroup = { heading?: string; items: NavItem[] };

const customerNav: NavGroup[] = [
  {
    items: [
      { href: "/portal", label: "Overview", icon: "overview" },
      { href: "/quotes", label: "Your quotations", icon: "quotes" },
      { href: "/jobs", label: "Your quotations", icon: "jobs" },
      { href: "/documents", label: "Your documents", icon: "documents" },
      { href: "/invoices", label: "Your invoices", icon: "invoices" },
      { href: "/portal/messages", label: "Messages", icon: "messages" },
    ],
  },
];

/**
 * The four teams BJH works in (client meeting, 2026-11-01), in the order work
 * flows: sales finds the client, customer service handles them, operations
 * runs the job, finance bills it. Finance is shown to finance, customer service
 * (BJH has no finance person yet) and the boss.
 */
const staffNav: NavGroup[] = [
  {
    items: [
      { href: "/", label: "Overview", icon: "overview", exact: true },
      {
        href: "/assistant",
        label: "Bra Evans",
        icon: "helper",
        roles: ["super_admin", "customer_service_rep"],
      },
    ],
  },
  {
    heading: "SALES",
    items: [
      {
        href: "/sales",
        label: "Sales",
        icon: "campaigns",
        alsoMatches: ["/campaigns"],
        roles: ["super_admin", "sales_rep", "customer_service_rep"],
        crm: true,
      },
      { href: "/customers/leads", label: "Leads", icon: "leads" },
      { href: "/customers", label: "Customers", icon: "customers" },
      { href: "/contacts", label: "Contacts", icon: "customers" },
    ],
  },
  {
    heading: "CUSTOMER SERVICE",
    items: [
      {
        href: "/quotations",
        label: "Inquiries",
        icon: "quotations",
        alsoMatches: ["/inquiries"],
      },
      { href: "/quotes", label: "Quotes", icon: "quotes" },
      {
        href: "/invoices",
        label: "Invoices",
        icon: "invoices",
        roles: ["super_admin", "finance_rep", "customer_service_rep"],
      },
    ],
  },
  {
    heading: "OPERATIONS",
    items: [
      { href: "/jobs", label: "Quotation", icon: "jobs" },
      { href: "/tasks", label: "Tasks", icon: "tasks" },
      { href: "/documents", label: "Documents", icon: "documents" },
      {
        href: "/shipping-documents",
        label: "Shipping documents",
        icon: "shipping",
      },
    ],
  },
  {
    heading: "MESSAGES",
    items: [
      { href: "/team-chat", label: "Team chat", icon: "team" },
      {
        href: "/chat",
        label: "Client chat",
        icon: "chat",
        roles: ["super_admin", "customer_service_rep"],
      },
      { href: "/messages", label: "Email & SMS", icon: "messages" },
    ],
  },
  {
    heading: "FINANCE",
    items: [
      {
        href: "/finance",
        label: "Finance",
        icon: "invoices",
        roles: ["super_admin", "finance_rep", "customer_service_rep"],
      },
    ],
  },
  {
    heading: "REPORTS",
    items: [
      { href: "/reports", label: "Reports", icon: "reports" },
      { href: "/performance", label: "Performance", icon: "tasks" },
    ],
  },
];

/** The staff menu as this person sees it; groups left empty disappear. */
function visibleGroups(
  groups: NavGroup[],
  roles: string[],
  crm: boolean,
): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          (!item.crm || crm) &&
          (!item.roles || item.roles.some((role) => roles.includes(role))),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

/** The menu entry for this page: the longest match, so Leads is not also Customers. */
function activeHref(pathname: string, groups: NavGroup[]): string | undefined {
  // Without their own Invoices entry, staff reach invoices from Finance (its Invoices tab).
  const items = groups.flatMap((group) => group.items);
  if (
    (pathname === "/invoices" || pathname.startsWith("/invoices/")) &&
    !items.some((item) => item.href === "/invoices")
  ) {
    const finance = items.find((item) => item.href === "/finance");
    if (finance) return finance.href;
  }
  return items
    .filter((entry) => matchesItem(pathname, entry))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

const collapsedKey = "bjh.sidebar.collapsed";
/** Phones and tablets held upright: the menu is a drawer, not a sidebar. */
const drawerQuery = "(max-width: 900px)";
const newRequestsEveryMs = 60_000;

const noBadges: WorkspaceBadges = {
  newQuoteRequests: 0,
  inquiriesForAPerson: 0,
  draftQuotes: 0,
  failedMessages: 0,
  chatUnread: 0,
};

/**
 * The menu badges: quote mail nobody has checked, inquiries that need a
 * person, draft quotes, messages that failed this week and unread client
 * chat. One small request, counted by the API, every minute while the tab is
 * on screen and after each page change.
 */
function useWorkspaceBadges(
  enabled: boolean,
  pathname: string,
): WorkspaceBadges {
  const [badges, setBadges] = useState<WorkspaceBadges>(noBadges);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const load = () =>
      getWorkspaceBadges()
        .then((counts) => {
          if (current) setBadges(counts);
        })
        // The badges are a hint; each page shows its own failures.
        .catch(() => undefined);
    void load();
    const stop = pollWhileVisible(load, newRequestsEveryMs);
    return () => {
      current = false;
      stop();
    };
  }, [enabled, pathname]);
  return enabled ? badges : noBadges;
}

/**
 * Unread team chat messages for the menu badge; every 30 seconds. The same
 * poll raises the browser pop-ups (Evans, 2026-11-04), which stay until read.
 */
function useTeamUnread(enabled: boolean, pathname: string): number {
  const [count, setCount] = useState(0);
  const router = useRouter();
  const popups = useRef<PopupState>(newPopupState());
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const load = () =>
      getTeamUnread()
        .then((result) => {
          if (!current) return;
          setCount(result.unread);
          return syncPopups(popups.current, result.conversations, {
            watching:
              pathname.startsWith("/team-chat") &&
              document.visibilityState === "visible" &&
              document.hasFocus(),
            open: (path) => router.push(path),
          });
        })
        // The badge is a hint; the Team chat page shows any failure.
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [enabled, pathname, router]);
  return enabled ? count : 0;
}

/** Pages reached from Settings or a link, not from the main menu. */
const settingsPages: Array<{ href: string; label: string }> = [
  { href: "/settings/business", label: "Business settings" },
  { href: "/settings/knowledge", label: "Knowledge base" },
  { href: "/settings/staff", label: "Staff management" },
  { href: "/settings/customer-accounts", label: "Customer accounts" },
  { href: "/settings/notifications", label: "Customer messages" },
  { href: "/settings/activity", label: "Activity log" },
  { href: "/settings/system-status", label: "System status" },
  { href: "/settings/support", label: "Support requests" },
  { href: "/admin/users", label: "Staff management" },
  { href: "/transport", label: "Transport" },
];

const matches = (pathname: string, href: string, exact?: boolean) =>
  exact || href === "/"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

const matchesItem = (pathname: string, item: NavItem) =>
  matches(pathname, item.href, item.exact) ||
  (item.alsoMatches ?? []).some((href) => matches(pathname, href));

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
    .filter((entry) => matchesItem(pathname, entry))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return { label: item?.label ?? "Overview", underSettings: false };
}

export function WorkspaceFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    isCustomer,
    isSuperAdmin,
    roles,
    crm,
    status,
    mustChangePassword,
    twoFactorRequired,
  } = useStaffAccess();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerMode, setDrawerMode] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const badges = useWorkspaceBadges(
    status === "ready" && !isCustomer,
    pathname,
  );
  const unreadTeam = useTeamUnread(status === "ready" && !isCustomer, pathname);
  const badgeOf = (item: NavItem) =>
    item.href === "/quotations"
      ? badges.newQuoteRequests + badges.inquiriesForAPerson
      : item.href === "/chat"
        ? badges.chatUnread
        : item.href === "/team-chat"
          ? unreadTeam
          : item.href === "/quotes"
            ? badges.draftQuotes
            : item.href === "/messages"
              ? badges.failedMessages
              : 0;

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

  useEffect(() => {
    const query = window.matchMedia(drawerQuery);
    const update = () => {
      setDrawerMode(query.matches);
      // Turning a tablet sideways puts the sidebar back; the drawer is not needed.
      if (!query.matches) setMenuOpen(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // Opening a page puts the drawer away.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Focus goes into the drawer when it opens and back to its button when it
  // closes, so keyboard and screen-reader users are never left behind it.
  useEffect(() => {
    if (menuOpen) closeButton.current?.focus();
    else if (wasOpen.current) menuButton.current?.focus();
    wasOpen.current = menuOpen;
  }, [menuOpen]);

  // While the drawer is open the page behind it stays still, and Escape closes it.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [menuOpen]);

  // Until the access check answers we do not know whose menu this is. Showing
  // the staff one meanwhile made customers see it flash on every refresh.
  const resolving = status === "loading";
  const groups = isCustomer ? customerNav : visibleGroups(staffNav, roles, crm);
  const crumb = pageCrumb(pathname, groups, isCustomer);
  const current = activeHref(pathname, groups);

  // Headings open and close. Left alone, only the heading you are in is open;
  // what someone opens or closes by hand overrides that.
  const activeHeading = groups.find((group) =>
    group.items.some((item) => item.href === current),
  )?.heading;
  const [headingChoice, setHeadingChoice] = useState<Record<string, boolean>>(
    {},
  );
  const headingOpen = (heading: string) =>
    headingChoice[heading] ?? heading === activeHeading;
  const toggleHeading = (heading: string) =>
    setHeadingChoice((choices) => ({
      ...choices,
      [heading]: !(choices[heading] ?? heading === activeHeading),
    }));
  // Going to a page opens its heading, even one that was closed by hand, so
  // the page you are on is never hidden.
  useEffect(() => {
    if (!activeHeading) return;
    setHeadingChoice((choices) => {
      if (choices[activeHeading] !== false) return choices;
      const next = { ...choices };
      delete next[activeHeading];
      return next;
    });
  }, [activeHeading]);

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

  return (
    <div
      className={`workspace-shell${collapsed && !drawerMode ? " collapsed" : ""}${menuOpen ? " menu-open" : ""}`}
    >
      <aside className="sidebar" id="workspace-sidebar">
        <button
          aria-label="Close menu"
          className="drawer-close"
          onClick={() => setMenuOpen(false)}
          ref={closeButton}
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
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
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
          {(resolving ? [] : groups).map((group) => {
            const heading = group.heading;
            // The icon rail has no room for headings, so it shows every page.
            const open =
              !heading || (collapsed && !drawerMode) || headingOpen(heading);
            const itemsId = `nav-${(heading ?? "main").toLowerCase().replace(/\s+/g, "-")}`;
            // A closed heading still shows what is waiting inside it.
            const waiting = group.items.reduce(
              (total, item) => total + badgeOf(item),
              0,
            );
            return (
              <div className="nav-group" key={heading ?? "main"}>
                {heading && (
                  <button
                    aria-controls={itemsId}
                    aria-expanded={open}
                    aria-label={
                      !open && waiting > 0
                        ? `${heading}, ${waiting} waiting`
                        : undefined
                    }
                    className="nav-heading nav-toggle"
                    onClick={() => toggleHeading(heading)}
                    type="button"
                  >
                    <span>{heading}</span>
                    {!open && waiting > 0 && (
                      <span className="nav-badge" aria-hidden="true">
                        {waiting > 99 ? "99+" : waiting}
                      </span>
                    )}
                    <svg
                      aria-hidden="true"
                      className="nav-chevron"
                      fill="none"
                      height="14"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      viewBox="0 0 24 24"
                      width="14"
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                )}
                <div className="nav-items" hidden={!open} id={itemsId}>
                  {group.items.map((item) => {
                    const active = item.href === current;
                    const badge = badgeOf(item);
                    const label = badge
                      ? `${item.label}, ${badge} ${
                          item.href === "/quotes"
                            ? "in draft"
                            : item.href === "/messages"
                              ? "failed to send"
                              : "new"
                        }`
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
              </div>
            );
          })}
        </nav>

        {!resolving && isSuperAdmin && (
          <SettingsSidebarSection active={settingsActive} />
        )}

        {!resolving && status === "ready" && (
          <div className="sidebar-support">
            <SupportButton />
          </div>
        )}
      </aside>
      {menuOpen && (
        <button
          aria-label="Close menu"
          className="menu-backdrop"
          onClick={() => setMenuOpen(false)}
          tabIndex={-1}
          type="button"
        />
      )}

      {/* Inert while the drawer is open: no Tab, tap or screen reader reaches the page behind it. */}
      <div className="workspace-main" inert={menuOpen}>
        {/* One header on every page: where you are, who is signed in, sign out. */}
        <header className="topbar">
          <div className="breadcrumb">
            <button
              aria-controls="workspace-sidebar"
              aria-expanded={menuOpen}
              aria-label="Open menu"
              className="menu-button"
              onClick={() => setMenuOpen(true)}
              ref={menuButton}
              type="button"
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="22"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="22"
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
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
            {!resolving && !isCustomer && status === "ready" && (
              <StaffNotices />
            )}
            <AuthStatus />
          </div>
        </header>
        {status === "ready" && <InstallPrompt />}
        {status === "ready" && !isCustomer && <PushPrompt />}
        {status === "unavailable" && (
          <p className="access-notice" role="alert">
            Your access could not be checked, so some buttons may be missing.
            <button onClick={() => window.location.reload()} type="button">
              Reload
            </button>
          </p>
        )}
        {/* Settings, drivers and vehicles, and staff are the super admin's alone. */}
        {settingsActive && !isSuperAdmin
          ? !resolving && (
              <main className="dashboard">
                <p className="access-notice" role="alert">
                  Settings are for the super admin only.
                </p>
              </main>
            )
          : children}
      </div>
    </div>
  );
}
