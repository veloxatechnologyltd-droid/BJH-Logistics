"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ErrorPopup } from "../ErrorPopup";
import { listProspects, promoteProspects } from "./campaignApi";
import type { Campaign, Prospect, ProspectFilter } from "./campaignApi";
import { safeWebUrl } from "./campaignView";
import ui from "../jobs/jobs.module.css";
import styles from "../customers/customerDirectory.module.css";
import own from "./campaigns.module.css";

const PAGE_SIZE = 50;

const views = [
  { key: "all", label: "All", filter: {} },
  { key: "good", label: "Good fit", filter: { qualified: true } },
  { key: "weak", label: "Weak fit", filter: { qualified: false } },
  {
    key: "duplicate",
    label: "Possible duplicates",
    filter: { duplicate: true },
  },
  { key: "added", label: "Added to leads", filter: { promoted: true } },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  filter: ProspectFilter;
}>;
type ViewKey = (typeof views)[number]["key"];

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

type Props = {
  campaign: Campaign;
  /** Changes when the search moves on, so the list reloads. */
  refreshKey: string;
  /** Called after businesses are added to Leads, so the campaign's counts are fetched again. */
  onChanged: () => void;
};

/** What a campaign found: best fit first, filterable, with the choice to add some to Leads. */
export function ProspectsTable({ campaign, refreshKey, onChanged }: Props) {
  const [view, setView] = useState<ViewKey>("all");
  const [search, setSearch] = useState("");
  const [typed, setTyped] = useState("");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<Prospect[] | null>(null);
  const [total, setTotal] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const latest = useRef(0);

  // The search box waits for a pause in typing before it asks again.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(typed);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const filter = views.find((entry) => entry.key === view)!.filter;
  const filterKey = JSON.stringify(filter);

  useEffect(() => {
    const ticket = ++latest.current;
    listProspects(campaign.id, {
      ...(JSON.parse(filterKey) as ProspectFilter),
      search,
      limit: PAGE_SIZE,
      offset,
    })
      .then((page) => {
        if (ticket !== latest.current) return;
        setItems(page.items);
        setTotal(page.total);
        // Only what is still on this page and not yet added stays chosen.
        setPicked((current) => {
          const open = new Set(
            page.items.filter((item) => !item.promotedLeadId).map((i) => i.id),
          );
          return new Set([...current].filter((id) => open.has(id)));
        });
      })
      .catch((cause) => {
        if (ticket === latest.current) {
          setError(message(cause, "The businesses could not be loaded"));
        }
      });
  }, [campaign.id, filterKey, search, offset, refreshKey, reload]);

  const open = (items ?? []).filter((item) => !item.promotedLeadId);
  const allPicked =
    open.length > 0 && open.every((item) => picked.has(item.id));

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function chooseView(key: ViewKey) {
    setView(key);
    setOffset(0);
    setPicked(new Set());
    setResult("");
  }

  async function addToLeads() {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const outcome = await promoteProspects(campaign.id, [...picked]);
      const parts = [
        `${outcome.promoted} added to Leads`,
        outcome.alreadyPromoted > 0
          ? `${outcome.alreadyPromoted} had already been added`
          : "",
        outcome.notFound > 0 ? `${outcome.notFound} could not be found` : "",
      ].filter(Boolean);
      setResult(`${parts.join(", ")}.`);
      setPicked(new Set());
      setReload((count) => count + 1);
      onChanged();
    } catch (cause) {
      setError(message(cause, "They could not be added to Leads"));
    } finally {
      setBusy(false);
    }
  }

  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + PAGE_SIZE, total);

  return (
    <section className={styles.directory} aria-label="Businesses found">
      <ErrorPopup message={error} />
      <div className={own.filterBar}>
        {/* Pills on a wide screen, a dropdown on a phone: five pills do not fit across it. */}
        <div className={own.viewButtons}>
          <div className={ui.segmented} role="group" aria-label="Show">
            {views.map((entry) => (
              <button
                aria-pressed={view === entry.key}
                className={view === entry.key ? ui.segmentActive : ""}
                key={entry.key}
                onClick={() => chooseView(entry.key)}
                type="button"
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
        <select
          aria-label="Show"
          className={own.viewSelect}
          onChange={(event) => chooseView(event.target.value as ViewKey)}
          value={view}
        >
          {views.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </select>
        <input
          aria-label="Search the businesses found by name"
          className={ui.searchInput}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Search by name"
          type="search"
          value={typed}
        />
      </div>
      <p className={own.help}>
        A good fit scores {campaign.qualificationThreshold} or more out of 100.
      </p>

      {result && (
        <p className={own.result} role="status">
          {result}{" "}
          <Link className={ui.textButton} href="/customers/leads">
            Open Leads
          </Link>
        </p>
      )}

      {picked.size > 0 && (
        <div className={own.bulkBar}>
          <strong>{picked.size} chosen</strong>
          <button
            className={ui.button}
            disabled={busy}
            onClick={() => void addToLeads()}
            type="button"
          >
            {busy ? "Adding…" : "Add to Leads"}
          </button>
          <button
            className={ui.secondaryButton}
            onClick={() => setPicked(new Set())}
            type="button"
          >
            Clear
          </button>
        </div>
      )}

      {!items && !error && <p className={ui.muted}>Loading…</p>}
      {items && items.length === 0 && (
        <div className={styles.emptyState}>
          <h2>No businesses here</h2>
          <p>
            {campaign.prospectCount === 0
              ? "Start a search to find businesses."
              : "Nothing matches this view."}
          </p>
        </div>
      )}
      {items && items.length > 0 && (
        <div className={`${styles.tableScroll} ${own.prospectsScroll}`}>
          <table className={styles.customerTable} data-cards>
            <thead>
              <tr>
                <th className={own.pick} scope="col">
                  <input
                    aria-label="Choose every business on this page that is not yet in Leads"
                    checked={allPicked}
                    disabled={open.length === 0}
                    onChange={() =>
                      setPicked(
                        allPicked ? new Set() : new Set(open.map((i) => i.id)),
                      )
                    }
                    type="checkbox"
                  />
                </th>
                <th scope="col">Business</th>
                <th scope="col">Fit</th>
                <th scope="col">Email</th>
                <th scope="col">Phone</th>
                <th scope="col">Address</th>
                <th scope="col">Website</th>
                <th scope="col">Leads</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <ProspectRow
                  chosen={picked.has(item.id)}
                  campaignId={campaign.id}
                  item={item}
                  key={item.id}
                  onToggle={() => toggle(item.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className={own.pager}>
          <span>
            Showing {first}–{last} of {total}
          </span>
          <span>
            <button
              className={ui.secondaryButton}
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              type="button"
            >
              Previous
            </button>{" "}
            <button
              className={ui.secondaryButton}
              disabled={last >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              type="button"
            >
              Next
            </button>
          </span>
        </div>
      )}
    </section>
  );
}

function ProspectRow({
  campaignId,
  item,
  chosen,
  onToggle,
}: {
  campaignId: string;
  item: Prospect;
  chosen: boolean;
  onToggle: () => void;
}) {
  const site = safeWebUrl(item.website);
  return (
    <tr>
      <td className={own.pick}>
        {!item.promotedLeadId && (
          <input
            aria-label={`Choose ${item.businessName}`}
            checked={chosen}
            onChange={onToggle}
            type="checkbox"
          />
        )}
      </td>
      <th scope="row">
        <Link
          className={own.nameLink}
          href={`/campaigns/${campaignId}/businesses/${item.id}`}
        >
          {item.businessName}
        </Link>
      </th>
      <td data-label="Fit">
        {item.score === null ? (
          "Not scored yet"
        ) : (
          <span className={own.score}>{item.score}</span>
        )}
      </td>
      <td data-label="Email">
        {item.emails.length > 0
          ? item.emails.slice(0, 2).map((email) => (
              <span className={own.cellLine} key={email}>
                {email}
              </span>
            ))
          : "—"}
      </td>
      <td data-label="Phone">
        {item.phones.length > 0
          ? item.phones.slice(0, 2).map((phone) => (
              <span className={own.cellLine} key={phone}>
                {phone}
              </span>
            ))
          : "—"}
      </td>
      <td data-label="Address">{item.address ?? "—"}</td>
      <td data-label="Website">
        {site ? (
          <a
            aria-label={`Visit the website of ${item.businessName}`}
            className={own.siteLink}
            href={site}
            rel="noopener noreferrer"
            target="_blank"
          >
            Visit
          </a>
        ) : (
          "—"
        )}
      </td>
      <td data-label="Leads">
        {item.promotedLeadId ? (
          <Link className={ui.textButton} href="/customers/leads">
            In Leads
          </Link>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}
