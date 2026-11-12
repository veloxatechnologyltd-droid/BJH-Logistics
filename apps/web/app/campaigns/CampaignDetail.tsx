"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ErrorPopup } from "../ErrorPopup";
import {
  cancelSearch,
  deleteCampaign,
  getCampaign,
  getCampaignConfig,
  startSearch,
  updateCampaign,
} from "./campaignApi";
import type { Campaign, CampaignConfig } from "./campaignApi";
import {
  campaignAbout,
  isActiveRun,
  runLabel,
  runSummary,
  searchSteps,
  startSearchWarning,
  statusLabels,
  stepsDone,
} from "./campaignView";
import { CampaignForm } from "./CampaignForm";
import { ProspectsTable } from "./ProspectsTable";
import { SampleDataNotice } from "./SampleDataNotice";
import ui from "../jobs/jobs.module.css";
import styles from "../customers/customerDirectory.module.css";
import own from "./campaigns.module.css";

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

type Confirming = "search" | "archive" | "delete" | null;

/** One campaign: its settings, the search and its progress, and the businesses it found. */
export function CampaignDetail() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [config, setConfig] = useState<CampaignConfig | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getCampaign(campaignId)
      .then(setCampaign)
      .catch((cause) =>
        setError(message(cause, "The campaign could not be loaded")),
      );
  }, [campaignId]);

  useEffect(() => {
    load();
    getCampaignConfig()
      .then(setConfig)
      .catch(() => undefined);
  }, [load]);

  const run = campaign?.latestRun ?? null;
  const searching = isActiveRun(run);
  useEffect(() => {
    if (!searching) return;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [searching, load]);

  /** Runs a change, then fetches the campaign again (not when the change removed it). */
  async function act(
    task: () => Promise<unknown>,
    failure: string,
    reload = true,
  ) {
    setBusy(true);
    setError("");
    try {
      await task();
      setConfirming(null);
      if (reload) load();
    } catch (cause) {
      setError(message(cause, failure));
    } finally {
      setBusy(false);
    }
  }

  if (!campaign) {
    return (
      <main className={styles.page}>
        <Link className={styles.backLink} href="/campaigns">
          <span aria-hidden="true">←</span> Back to campaigns
        </Link>
        <ErrorPopup message={error} />
        {!error && <p className={ui.muted}>Loading…</p>}
      </main>
    );
  }

  const canSearch = campaign.status === "active" && !searching;
  const refreshKey = run ? `${run.id}:${run.status}:${run.step}` : "none";

  return (
    <main className={styles.page}>
      <Link className={styles.backLink} href="/campaigns">
        <span aria-hidden="true">←</span> Back to campaigns
      </Link>

      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{campaign.name}</h1>
          <p className={styles.description}>
            <span className={ui.badge}>{statusLabels[campaign.status]}</span>{" "}
            {campaignAbout(campaign)}
          </p>
        </div>
        <div className={own.headerActions}>
          {canSearch && (
            <button
              className={ui.button}
              disabled={busy}
              onClick={() =>
                // A made-up search costs nothing; a real one is charged, so it asks first.
                config?.sampleData
                  ? void act(
                      () => startSearch(campaign.id),
                      "The search could not be started",
                    )
                  : setConfirming("search")
              }
              type="button"
            >
              Find businesses
            </button>
          )}
          {campaign.status === "active" && (
            <button
              className={ui.secondaryButton}
              disabled={busy}
              onClick={() =>
                void act(
                  () => updateCampaign(campaign.id, { status: "paused" }),
                  "The campaign could not be paused",
                )
              }
              type="button"
            >
              Pause
            </button>
          )}
          {campaign.status !== "active" && (
            <button
              className={ui.secondaryButton}
              disabled={busy}
              onClick={() =>
                void act(
                  () => updateCampaign(campaign.id, { status: "active" }),
                  "The campaign could not be resumed",
                )
              }
              type="button"
            >
              {campaign.status === "archived" ? "Reopen" : "Resume"}
            </button>
          )}
          <button
            className={ui.secondaryButton}
            onClick={() => setEditing((open) => !open)}
            type="button"
          >
            {editing ? "Close settings" : "Edit settings"}
          </button>
        </div>
      </header>

      <SampleDataNotice config={config} />
      <ErrorPopup message={error} />

      {confirming === "search" && (
        <div className={own.confirm} role="group" aria-label="Start a search">
          <p>{startSearchWarning}</p>
          <div className={ui.formActions}>
            <button
              className={ui.button}
              disabled={busy}
              onClick={() =>
                void act(
                  () => startSearch(campaign.id),
                  "The search could not be started",
                )
              }
              type="button"
            >
              Start the search
            </button>
            <button
              className={ui.secondaryButton}
              onClick={() => setConfirming(null)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {editing ? (
        <section className={ui.card} aria-label="Campaign settings">
          <h2>Settings</h2>
          <CampaignForm
            campaign={campaign}
            onCancel={() => setEditing(false)}
            onSaved={(saved) => {
              setCampaign(saved);
              setEditing(false);
            }}
          />
        </section>
      ) : (
        <section className={ui.card} aria-label="Campaign settings">
          <h2>Settings</h2>
          <dl className={own.settingsList}>
            <Setting label="Looks for" value={campaign.targetIndustry} />
            <Setting label="Where" value={campaign.targetLocation} />
            <Setting label="Service to offer" value={campaign.targetService} />
            <Setting
              label="Search words"
              value={
                campaign.searchKeywords.join(", ") || "The kind of business"
              }
            />
            <Setting
              label="Words to skip"
              value={campaign.excludedKeywords.join(", ") || "None"}
            />
            <Setting
              label="Lowest rating"
              value={
                campaign.minRating === null
                  ? "Any"
                  : `${campaign.minRating.toFixed(1)} stars`
              }
            />
            <Setting
              label="Website"
              value={campaign.requireWebsite ? "Required" : "Not required"}
            />
            <Setting
              label="Good fit from"
              value={`${campaign.qualificationThreshold} out of 100`}
            />
            <Setting
              label="Most to find"
              value={String(campaign.maxProspects)}
            />
            {campaign.idealCustomerProfile && (
              <Setting
                label="Ideal customer"
                value={campaign.idealCustomerProfile}
              />
            )}
            {campaign.disqualifiers && (
              <Setting label="Not a fit" value={campaign.disqualifiers} />
            )}
          </dl>
        </section>
      )}

      <section className={ui.card} aria-label="Search">
        <h2>Search</h2>
        {!run && (
          <p className={ui.muted}>
            {campaign.status === "active"
              ? "No search yet. Press “Find businesses” to start one."
              : "This campaign is not active, so it cannot search."}
          </p>
        )}
        {run && (
          <>
            <p>
              <strong>{runLabel(run)}</strong>
            </p>
            {(searching || run.status === "ready") && (
              <ol className={own.stepList} aria-label="Steps of the search">
                {searchSteps.map((step, index) => {
                  const done = stepsDone(run);
                  const state =
                    index < done
                      ? own.stepDone
                      : index === done
                        ? own.stepNow
                        : "";
                  return (
                    <li
                      aria-current={index === done ? "step" : undefined}
                      className={`${own.step} ${state}`}
                      key={step.key}
                    >
                      {step.label}
                    </li>
                  );
                })}
              </ol>
            )}
            {run.status === "failed" ? (
              <p className={own.failure} role="alert">
                {runSummary(run)}
              </p>
            ) : (
              <p className={own.summary}>{runSummary(run)}</p>
            )}
            {searching && (
              <div className={ui.formActions}>
                <button
                  className={ui.secondaryButton}
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => cancelSearch(campaign.id, run.id),
                      "The search could not be cancelled",
                    )
                  }
                  type="button"
                >
                  Cancel the search
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <ProspectsTable
        campaign={campaign}
        onChanged={load}
        refreshKey={refreshKey}
      />

      <section className={ui.card} aria-label="Remove the campaign">
        <h2>Archive or delete</h2>
        <p className={ui.muted}>
          Archiving stops the campaign and any search still waiting. Deleting
          removes it and everything it found. Leads already added to Leads stay.
        </p>
        {confirming === "archive" || confirming === "delete" ? (
          <div className={own.confirm} role="group" aria-label="Confirm">
            <p>
              {confirming === "archive"
                ? "Archive this campaign?"
                : `Delete this campaign and its ${campaign.prospectCount} businesses? ${campaign.promotedCount} already in Leads will stay. This cannot be undone.`}
            </p>
            <div className={ui.formActions}>
              <button
                className={ui.button}
                disabled={busy}
                onClick={() =>
                  confirming === "archive"
                    ? void act(
                        () =>
                          updateCampaign(campaign.id, { status: "archived" }),
                        "The campaign could not be archived",
                      )
                    : void act(
                        async () => {
                          await deleteCampaign(campaign.id);
                          router.push("/campaigns");
                        },
                        "The campaign could not be deleted",
                        false,
                      )
                }
                type="button"
              >
                {confirming === "archive" ? "Archive" : "Delete"}
              </button>
              <button
                className={ui.secondaryButton}
                onClick={() => setConfirming(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className={ui.formActions}>
            {campaign.status !== "archived" && (
              <button
                className={ui.secondaryButton}
                onClick={() => setConfirming("archive")}
                type="button"
              >
                Archive
              </button>
            )}
            <button
              className={ui.secondaryButton}
              onClick={() => setConfirming("delete")}
              type="button"
            >
              Delete
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function Setting({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
