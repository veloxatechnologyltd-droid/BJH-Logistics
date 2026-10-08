"use client";

import { useEffect, useState } from "react";
import { authenticatedFetch } from "./authenticatedFetch";
import { getSupabaseBrowserClient } from "./supabaseBrowserClient";

export type CustomerCompany = { companyId: string; companyName: string };

type StaffAccessState = {
  status: "loading" | "ready" | "unavailable";
  roles: string[];
  /** The companies linked to a customer account; empty for staff. */
  companies: CustomerCompany[];
  /** The admin set this password; the user must choose their own first. */
  mustChangePassword: boolean;
  /** The super admin still has to finish the second sign-in step. */
  twoFactorRequired: boolean;
};

const none = {
  roles: [],
  companies: [],
  mustChangePassword: false,
  twoFactorRequired: false,
};

const initial: StaffAccessState = { status: "loading", ...none };

type Access = Omit<StaffAccessState, "status">;

async function fetchAccess(apiBase: string): Promise<Access> {
  const response = await authenticatedFetch(`${apiBase}/v1/auth/session`);
  if (response.status === 403) {
    return none;
  }
  if (!response.ok) {
    throw new Error("Staff access could not be checked");
  }
  const session = (await response.json()) as {
    roles?: unknown;
    companies?: unknown;
    mustChangePassword?: unknown;
    twoFactorRequired?: unknown;
  };
  return {
    roles: Array.isArray(session.roles)
      ? session.roles.filter((role): role is string => typeof role === "string")
      : [],
    companies: Array.isArray(session.companies)
      ? (session.companies as CustomerCompany[])
      : [],
    mustChangePassword: session.mustChangePassword === true,
    twoFactorRequired: session.twoFactorRequired === true,
  };
}

// Many components on one page ask who is signed in. They share one request,
// kept for a short while and only for the same sign-in (a different user has
// a different token), so a page costs the API one lookup, not one per component.
const reuseMs = 20_000;
let shared: { token: string; at: number; request: Promise<Access> } | null =
  null;

async function loadAccess(apiBase: string): Promise<Access> {
  const session = await getSupabaseBrowserClient()?.auth.getSession();
  const token = session?.data.session?.access_token;
  if (token && shared?.token === token && Date.now() - shared.at < reuseMs) {
    return shared.request;
  }
  const request = fetchAccess(apiBase);
  if (token) {
    shared = { token, at: Date.now(), request };
    // A failed lookup is not kept: the next component asks again.
    request.catch(() => {
      if (shared?.request === request) shared = null;
    });
  }
  return request;
}

export function useStaffAccess() {
  const [access, setAccess] = useState<StaffAccessState>(initial);

  useEffect(() => {
    let active = true;
    const apiBase =
      process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";

    // Runs on mount and again whenever someone signs in or out, because the
    // page frame that uses this stays mounted across a sign-in.
    const load = () => {
      void loadAccess(apiBase)
        .then((loaded) => {
          if (active) setAccess({ status: "ready", ...loaded });
        })
        .catch(() => {
          if (active) setAccess({ status: "unavailable", ...none });
        });
    };

    load();
    const supabase = getSupabaseBrowserClient();
    const subscription = supabase?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        setAccess(initial);
        // Deferred: the client is still finishing the sign-in when this fires.
        setTimeout(load, 0);
      }
    });

    return () => {
      active = false;
      subscription?.data.subscription.unsubscribe();
    };
  }, []);

  const isSuperAdmin = access.roles.includes("super_admin");
  return {
    ...access,
    isSuperAdmin,
    isDepartmentStaff: access.roles.length > 0 && !isSuperAdmin,
    isCustomer: access.roles.length === 0 && access.companies.length > 0,
  };
}
