"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorPopup } from "../../ErrorPopup";
import { listCampaigns, promoteProspects } from "../../campaigns/campaignApi";
import type { Campaign } from "../../campaigns/campaignApi";
import { safeWebUrl } from "../../campaigns/campaignView";
import {
  announceDraftsChanged,
  createDrafts,
  dismissProspects,
  listPool,
} from "../salesApi";
import type {
  PoolFilter,
  PoolProspect,
  PoolSort,
  PoolStatus,
} from "../salesApi";
import {
  draftOutcome,
  draftStatusLabels,
  inGroups,
  poolToCsv,
  scoreTone,
} from "../salesView";
import { SocialLinkList } from "../SocialLinkList";
import styles from "../sales.module.css";

const PAGE_SIZE = 100;
/** The API drafts at most this many emails in one request. */
const DRAFT_BATCH = 20;

const statusOptions: Array<[PoolStatus, string]> = [
  ["new", "Waiting"],
  ["added", "Added to leads"],
  ["dismissed", "Set aside"],
  ["all", "All"],
];

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

/** Every business any campaign found, in one place to review, add to leads, set aside or write to. */
export function LeadPool() {
  const [filter, setFilter] = useState<PoolFilter>({
    status: "new",
    sort: "score",
    limit: PAGE_SIZE,
    offset: 0,
  });
  const [searchText, setSearchText] = useState("");
  const [rows, setRows] = useState<PoolProspect[] | null>(null);
  const [total, setTotal] = useState(0);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; link?: string } | null>(
    null,
  );
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listPool(filter)
      .then((page) => {
        setRows(page.items);
        setTotal(page.total);
      })
      .catch((cause) =>
        setError(message(cause, "The lead pool could not be loaded")),
      );
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    listCampaigns()
      .then(setCampaigns)
      .catch(() => undefined);
  }, []);

  // Typing in the search box waits a moment before it asks the API.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter((current) =>
        (current.search ?? "") === searchText
          ? current
          : { ...current, search: searchText, offset: 0 },
      );
    }, 350);
    return () => clearTimeout(timer);
  }, [searchText]);

  function change(update: Partial<PoolFilter>) {
    setSelected(new Set());
    setFilter((current) => ({ ...current, ...update, offset: 0 }));
  }

  const chosen = useMemo(
    () => (rows ?? []).filter((row) => selected.has(row.id)),
    [rows, selected],
  );
  const allChosen =
    (rows ?? []).length > 0 && chosen.length === (rows ?? []).length;
  const waitingChosen = chosen.filter(
    (row) => row.promotedLeadId === null && row.dismissedAt === null,
  );
  const draftable = chosen.filter(
    (row) => row.emails.length > 0 && row.dismissedAt === null,
  );
  const restorable = chosen.filter((row) => row.dismissedAt !== null);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run(work: () => Promise<void>, failure: string) {
    setBusy(true);
    setError("");
    setNotice(null);
    try {
      await work();
      setSelected(new Set());
      load();
    } catch (cause) {
      setError(message(cause, failure));
    } finally {
      setBusy(false);
    }
  }

  const addToLeads = () =>
    run(async () => {
      // A prospect is added through its own campaign.
      const byCampaign = new Map<string, string[]>();
      for (const row of waitingChosen) {
        byCampaign.set(row.campaignId, [
          ...(byCampaign.get(row.campaignId) ?? []),
          row.id,
        ]);
      }
      let added = 0;
      for (const [campaignId, ids] of byCampaign) {
        for (const group of inGroups(ids, 100)) {
          added += (await promoteProspects(campaignId, group)).promoted;
        }
      }
      setNotice({
        text: `Added ${added} ${added === 1 ? "business" : "businesses"} to leads.`,
        link: "/sales/pipeline",
      });
    }, "The businesses could not be added to leads");

  const draftEmails = () =>
    run(async () => {
      let created = 0;
      const skipped: Array<{
        businessName: string | null;
        reason: Parameters<typeof draftOutcome>[1][number]["reason"];
      }> = [];
      for (const group of inGroups(
        draftable.map((row) => row.id),
        DRAFT_BATCH,
      )) {
        const result = await createDrafts(group);
        created += result.created.length;
        skipped.push(...result.skipped);
      }
      announceDraftsChanged();
      setNotice({
        text: draftOutcome(created, skipped),
        link: created > 0 ? "/sales/approvals" : undefined,
      });
    }, "The emails could not be drafted");

  const setAside = (dismissed: boolean) =>
    run(async () => {
      const targets = dismissed ? waitingChosen : restorable;
      const result = await dismissProspects(
        targets.map((row) => row.id),
        dismissed,
      );
      setNotice({
        text: dismissed
          ? `Set aside ${result.changed}. They stay under “Set aside” and can be brought back.`
          : `Brought back ${result.changed}.`,
      });
    }, "The businesses could not be updated");

  function exportCsv() {
    const blob = new Blob([poolToCsv(rows ?? [])], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lead-pool-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const from = total === 0 ? 0 : filter.offset + 1;
  const to = Math.min(total, filter.offset + PAGE_SIZE);

  return (
    <>
      <ErrorPopup message={error} />

      <div
        className={styles.filterBar}
        role="group"
        aria-label="Filter the pool"
      >
        <input
          aria-label="Search by name, type or address"
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Search by name, type or address"
          type="search"
          value={searchText}
        />
        <select
          aria-label="Campaign"
          onChange={(event) =>
            change({ campaignId: event.target.value || undefined })
          }
          value={filter.campaignId ?? ""}
        >
          <option value="">All campaigns</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Show"
          onChange={(event) =>
            change({ status: event.target.value as PoolStatus })
          }
          value={filter.status}
        >
          {statusOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Lowest fit score"
          onChange={(event) =>
            change({ minScore: Number(event.target.value) || undefined })
          }
          value={filter.minScore ?? 0}
        >
          <option value={0}>Any score</option>
          <option value={50}>Score 50 or more</option>
          <option value={70}>Score 70 or more</option>
          <option value={85}>Score 85 or more</option>
        </select>
        <select
          aria-label="Sort by"
          onChange={(event) => change({ sort: event.target.value as PoolSort })}
          value={filter.sort}
        >
          <option value="score">Best fit first</option>
          <option value="newest">Newest first</option>
          <option value="name">Name A to Z</option>
        </select>
        <label className={styles.check}>
          <input
            checked={filter.hasEmail === true}
            onChange={(event) =>
              change({ hasEmail: event.target.checked || undefined })
            }
            type="checkbox"
          />
          Has an email
        </label>
      </div>

      {notice && (
        <p className={styles.statusLine} role="status">
          {notice.text}{" "}
          {notice.link && (
            <Link href={notice.link}>
              {notice.link === "/sales/approvals"
                ? "Review them in Approvals"
                : "Open the pipeline"}
            </Link>
          )}
        </p>
      )}

      {chosen.length > 0 && (
        <div
          className={styles.bulkBar}
          role="region"
          aria-label="Chosen businesses"
        >
          <span className={styles.bulkCount}>{chosen.length} chosen</span>
          {waitingChosen.length > 0 && (
            <button
              className={styles.btnPrimary}
              disabled={busy}
              onClick={addToLeads}
              type="button"
            >
              Add to leads ({waitingChosen.length})
            </button>
          )}
          {draftable.length > 0 && (
            <button
              className={styles.btn}
              disabled={busy}
              onClick={draftEmails}
              type="button"
            >
              {busy ? "Working…" : `Draft emails (${draftable.length})`}
            </button>
          )}
          {waitingChosen.length > 0 && (
            <button
              className={styles.btn}
              disabled={busy}
              onClick={() => setAside(true)}
              type="button"
            >
              Set aside
            </button>
          )}
          {restorable.length > 0 && (
            <button
              className={styles.btn}
              disabled={busy}
              onClick={() => setAside(false)}
              type="button"
            >
              Bring back ({restorable.length})
            </button>
          )}
          <button
            className={styles.btnQuiet}
            onClick={() => setSelected(new Set())}
            type="button"
          >
            Clear
          </button>
        </div>
      )}

      <div className={styles.filterBar}>
        <label className={styles.check}>
          <input
            checked={allChosen}
            disabled={(rows ?? []).length === 0}
            onChange={() =>
              setSelected(
                allChosen ? new Set() : new Set((rows ?? []).map((r) => r.id)),
              )
            }
            type="checkbox"
          />
          Choose everything on this page
        </label>
        <span className={styles.contactNone} style={{ marginLeft: "auto" }}>
          {rows ? `${total} ${total === 1 ? "business" : "businesses"}` : ""}
        </span>
        <button
          className={styles.btn}
          disabled={!rows || rows.length === 0}
          onClick={exportCsv}
          type="button"
        >
          Export this page (CSV)
        </button>
      </div>

      {!rows && !error && <p className={styles.empty}>Loading…</p>}

      {rows && rows.length === 0 && (
        <div className={styles.emptyState}>
          <h2>
            {filter.search ||
            filter.campaignId ||
            filter.minScore ||
            filter.hasEmail ||
            filter.status !== "new"
              ? "No businesses match"
              : "The pool is empty"}
          </h2>
          <p>
            {filter.status === "new" && !filter.search && !filter.campaignId
              ? "Businesses found by a campaign wait here for you to review. Run a search to fill it."
              : "Try another filter, or clear the search."}
          </p>
          <Link className={styles.btnPrimary} href="/campaigns">
            Go to campaigns
          </Link>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.poolTable} data-cards>
            <thead>
              <tr>
                <th scope="col">Business</th>
                <th scope="col">Address</th>
                <th scope="col">Website</th>
                <th scope="col">Fit</th>
                <th scope="col">Email</th>
                <th scope="col">Social media</th>
                <th scope="col">Phone</th>
                <th scope="col">Campaign</th>
                <th scope="col">Draft</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const tone = scoreTone(row.score, row.qualificationThreshold);
                const site = safeWebUrl(row.website);
                return (
                  <tr
                    className={selected.has(row.id) ? styles.rowSelected : ""}
                    key={row.id}
                  >
                    <th scope="row">
                      <div style={{ display: "flex", gap: 10 }}>
                        <input
                          aria-label={`Choose ${row.businessName}`}
                          checked={selected.has(row.id)}
                          onChange={() => toggle(row.id)}
                          style={{ marginTop: 3 }}
                          type="checkbox"
                        />
                        <span>
                          <span className={styles.bizName}>
                            <Link
                              href={`/campaigns/${row.campaignId}/businesses/${row.id}`}
                            >
                              {row.businessName}
                            </Link>
                          </span>
                          <span className={styles.bizSub}>{row.category}</span>
                          <span
                            className={styles.draftMeta}
                            style={{ marginTop: 6 }}
                          >
                            {row.source === "stub" && (
                              <span
                                className={`${styles.pill} ${styles.pillOutline}`}
                              >
                                Sample
                              </span>
                            )}
                            {row.promotedLeadId && (
                              <span className={styles.pill}>In leads</span>
                            )}
                            {row.dismissedAt && (
                              <span
                                className={`${styles.pill} ${styles.pillOutline}`}
                              >
                                Set aside
                              </span>
                            )}
                            {row.duplicateKind && (
                              <span
                                className={`${styles.pill} ${styles.pillOutline}`}
                                title={row.duplicateReason ?? undefined}
                              >
                                Possible duplicate
                              </span>
                            )}
                          </span>
                        </span>
                      </div>
                    </th>
                    <td data-label="Address">
                      {row.address ?? (
                        <span className={styles.contactNone}>—</span>
                      )}
                    </td>
                    <td data-label="Website">
                      {site ? (
                        <a
                          className={styles.btn}
                          href={site}
                          rel="noreferrer noopener"
                          target="_blank"
                        >
                          Visit website
                        </a>
                      ) : (
                        <span className={styles.contactNone}>—</span>
                      )}
                    </td>
                    <td data-label="Fit">
                      {row.score === null ? (
                        <span className={styles.contactNone}>Not scored</span>
                      ) : (
                        <>
                          <span
                            className={`${styles.score} ${
                              tone === "good"
                                ? styles.scoreGood
                                : tone === "mid"
                                  ? styles.scoreMid
                                  : styles.scoreLow
                            }`}
                          >
                            {row.score}
                          </span>
                          <span className={styles.bizSub}>
                            {row.scoreMethod === "ai"
                              ? "Scored by AI"
                              : "Simple rules"}
                          </span>
                          {row.scoreReason && (
                            <details className={styles.why}>
                              <summary>Why</summary>
                              <p>{row.scoreReason}</p>
                            </details>
                          )}
                        </>
                      )}
                    </td>
                    <td data-label="Email">
                      {row.emails.slice(0, 2).map((email) => (
                        <span className={styles.contactLine} key={email}>
                          {email}
                        </span>
                      ))}
                      {row.emails.length === 0 && (
                        <span className={styles.contactNone}>
                          No email found
                        </span>
                      )}
                    </td>
                    <td data-label="Social media">
                      <SocialLinkList links={row.socialLinks} />
                    </td>
                    <td data-label="Phone">
                      {row.phones.slice(0, 2).map((phone) => (
                        <span className={styles.contactLine} key={phone}>
                          {phone}
                        </span>
                      ))}
                      {row.phones.length === 0 && (
                        <span className={styles.contactNone}>
                          No phone found
                        </span>
                      )}
                    </td>
                    <td data-label="Campaign">
                      <Link href={`/campaigns/${row.campaignId}`}>
                        {row.campaignName}
                      </Link>
                    </td>
                    <td data-label="Draft">
                      {row.draftStatus ? (
                        <Link href="/sales/approvals">
                          {draftStatusLabels[row.draftStatus]}
                        </Link>
                      ) : (
                        <span className={styles.contactNone}>Not drafted</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows && total > PAGE_SIZE && (
        <div className={styles.pager}>
          <span>
            {from}–{to} of {total}
          </span>
          <span className={styles.actions}>
            <button
              className={styles.btn}
              disabled={filter.offset === 0}
              onClick={() => {
                setSelected(new Set());
                setFilter((c) => ({
                  ...c,
                  offset: Math.max(0, c.offset - PAGE_SIZE),
                }));
              }}
              type="button"
            >
              Previous
            </button>
            <button
              className={styles.btn}
              disabled={to >= total}
              onClick={() => {
                setSelected(new Set());
                setFilter((c) => ({ ...c, offset: c.offset + PAGE_SIZE }));
              }}
              type="button"
            >
              Next
            </button>
          </span>
        </div>
      )}
    </>
  );
}
