"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorPopup } from "../ErrorPopup";
import { getCampaignConfig, listCampaigns } from "./campaignApi";
import type { Campaign, CampaignConfig } from "./campaignApi";
import {
  campaignAbout,
  isActiveRun,
  runLabel,
  runSummary,
  statusLabels,
} from "./campaignView";
import { SampleDataNotice } from "./SampleDataNotice";
import ui from "../jobs/jobs.module.css";
import styles from "../customers/customerDirectory.module.css";
import own from "./campaigns.module.css";

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

const shortDate = (value: string) =>
  new Date(value).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** Every campaign with its latest search; a search that is going is refreshed as it moves. */
export function CampaignsList() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [config, setConfig] = useState<CampaignConfig | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listCampaigns()
      .then(setCampaigns)
      .catch((cause) =>
        setError(message(cause, "Campaigns could not be loaded")),
      );
  }, []);

  useEffect(() => {
    load();
    getCampaignConfig()
      .then(setConfig)
      .catch(() => undefined);
  }, [load]);

  const searching = (campaigns ?? []).some((campaign) =>
    isActiveRun(campaign.latestRun),
  );
  useEffect(() => {
    if (!searching) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [searching, load]);

  return (
    <>
      <SampleDataNotice config={config} />
      <ErrorPopup message={error} />
      <section className={styles.directory} aria-label="Campaigns">
        {!campaigns && !error && <p className={ui.muted}>Loading…</p>}
        {campaigns && campaigns.length === 0 && (
          <div className={styles.emptyState}>
            <h2>No campaigns yet</h2>
            <p>
              A campaign says what kind of business to look for and where. It
              finds them, scores how well each fits, and lets you add the good
              ones to Leads.
            </p>
            <Link className={ui.primaryLink} href="/campaigns/new">
              Create the first campaign
            </Link>
          </div>
        )}
        {campaigns && campaigns.length > 0 && (
          <div className={styles.tableScroll}>
            <table className={styles.customerTable} data-cards>
              <thead>
                <tr>
                  <th scope="col">Campaign</th>
                  <th scope="col">Status</th>
                  <th scope="col">Latest search</th>
                  <th scope="col">Businesses found</th>
                  <th scope="col">Added to leads</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <th scope="row">
                      <Link
                        className={own.nameLink}
                        href={`/campaigns/${campaign.id}`}
                      >
                        {campaign.name}
                      </Link>
                      <span className={own.about}>
                        {campaignAbout(campaign)}
                      </span>
                    </th>
                    <td data-label="Status">
                      <span className={ui.badge}>
                        {statusLabels[campaign.status]}
                      </span>
                    </td>
                    <td data-label="Latest search" data-wide>
                      {campaign.latestRun ? (
                        <>
                          <strong>{runLabel(campaign.latestRun)}</strong>
                          <span className={own.about}>
                            {shortDate(campaign.latestRun.createdAt)}
                            {" · "}
                            {runSummary(campaign.latestRun)}
                          </span>
                        </>
                      ) : (
                        "Not searched yet"
                      )}
                    </td>
                    <td data-label="Businesses found">
                      {campaign.prospectCount}
                    </td>
                    <td data-label="Added to leads">
                      {campaign.promotedCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
