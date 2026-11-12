"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ErrorPopup } from "../ErrorPopup";
import {
  announceDraftsChanged,
  createDrafts,
  listDrafts,
} from "../sales/salesApi";
import type { Draft } from "../sales/salesApi";
import { getCampaign, getProspect } from "./campaignApi";
import type { Campaign, Prospect } from "./campaignApi";
import { safeWebUrl, scoreMethodLabel, socialLinkGroups } from "./campaignView";
import ui from "../jobs/jobs.module.css";
import styles from "../customers/customerDirectory.module.css";
import own from "./campaigns.module.css";

const enrichmentText: Record<Prospect["enrichmentStatus"], string> = {
  pending: "Website not read yet",
  email_found: "Email found",
  email_missing: "No email found on their website",
  failed: "Their website could not be read",
};

const duplicateText = {
  prospect: "another business found by a campaign",
  customer: "a customer",
  lead: "a lead",
} as const;

const none = <span className={own.detailNone}>None found</span>;

/** A full page of everything a campaign's search found about one business. */
export function ProspectDetails() {
  const { campaignId, prospectId } = useParams<{
    campaignId: string;
    prospectId: string;
  }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [item, setItem] = useState<Prospect | null>(null);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [draftError, setDraftError] = useState("");
  const [draftNotice, setDraftNotice] = useState("");
  const [drafting, setDrafting] = useState(false);

  const loadDrafts = useCallback(async () => {
    setDraftError("");
    try {
      const page = await listDrafts(undefined, 100, 0, prospectId);
      setDrafts(page.items);
    } catch (cause) {
      setDraftError(
        cause instanceof Error
          ? cause.message
          : "Outreach messages could not be loaded",
      );
    }
  }, [prospectId]);

  useEffect(() => {
    Promise.all([getCampaign(campaignId), getProspect(campaignId, prospectId)])
      .then(([loadedCampaign, loadedItem]) => {
        setCampaign(loadedCampaign);
        setItem(loadedItem);
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "The business could not be loaded",
        ),
      );
  }, [campaignId, prospectId]);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

  async function generateDraft() {
    setDrafting(true);
    setDraftError("");
    setDraftNotice("");
    try {
      const result = await createDrafts([prospectId]);
      if (result.created.length) {
        setDrafts((current) => [result.created[0], ...(current ?? [])]);
        setDraftNotice(
          "Email draft created. Review it before anything is sent.",
        );
        announceDraftsChanged();
      } else {
        const reason = result.skipped[0]?.reason;
        setDraftNotice(
          reason === "no_email"
            ? "Add an email address before drafting an outreach email."
            : reason === "dismissed"
              ? "This business is set aside in the lead pool, so a draft cannot be created."
              : reason === "already_drafted"
                ? "An open draft already exists for this business."
                : "A draft could not be created for this business.",
        );
        if (reason === "already_drafted") await loadDrafts();
      }
    } catch (cause) {
      setDraftError(
        cause instanceof Error
          ? cause.message
          : "The email draft could not be created",
      );
    } finally {
      setDrafting(false);
    }
  }

  const back = (
    <Link className={styles.backLink} href={`/campaigns/${campaignId}`}>
      <span aria-hidden="true">←</span> Back to{" "}
      {campaign ? campaign.name : "the campaign"}
    </Link>
  );

  if (!item || !campaign) {
    return (
      <main className={styles.page}>
        {back}
        <ErrorPopup message={error} />
        {!error && <p className={ui.muted}>Loading…</p>}
      </main>
    );
  }

  const site = safeWebUrl(item.website);
  const socials = socialLinkGroups(item.socialLinks);
  const fitPercent =
    item.score === null ? 0 : Math.max(0, Math.min(item.score, 100));

  return (
    <main className={styles.page}>
      {back}

      <header className={`${styles.header} ${own.profileHeader}`}>
        <div className={own.profileIdentity}>
          <p className={own.profileEyebrow}>Business profile</p>
          <h1 className={styles.title}>{item.businessName}</h1>
          <div className={own.tags}>
            {item.category && <span className={ui.badge}>{item.category}</span>}
            {item.source === "stub" && (
              <span className={ui.badge}>Sample data</span>
            )}
            {item.duplicateKind && (
              <span className={ui.badge}>Possible duplicate</span>
            )}
            {item.promotedLeadId && <span className={ui.badge}>In Leads</span>}
          </div>
        </div>
        {item.promotedLeadId && (
          <Link className={ui.secondaryButton} href="/customers/leads">
            Open lead
          </Link>
        )}
      </header>

      <div className={own.detailGrid}>
        <section
          className={`${own.detailCard} ${own.fitCard}`}
          aria-label="Business fit"
        >
          <div className={own.sectionHeading}>
            <div>
              <p className={own.sectionEyebrow}>Qualification</p>
              <h2>Business fit</h2>
            </div>
            {item.score !== null && (
              <span
                className={
                  item.score >= campaign.qualificationThreshold
                    ? own.fitStatus
                    : own.fitStatusMuted
                }
              >
                {item.score >= campaign.qualificationThreshold
                  ? "Qualified"
                  : "Needs review"}
              </span>
            )}
          </div>
          {item.score === null ? (
            <p className={own.detailNone}>
              This business has not been scored yet.
            </p>
          ) : (
            <div className={own.fitContent}>
              <div className={own.scoreLine}>
                <span className={own.score}>{item.score}</span>
                <span className={own.detailOutOf}>/ 100</span>
                <span className={own.scoreMethod}>
                  Scored by {scoreMethodLabel(item.scoreMethod)}
                </span>
              </div>
              <div
                className={own.scoreTrack}
                role="progressbar"
                aria-label="Business fit score"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={fitPercent}
              >
                <span style={{ width: `${fitPercent}%` }} />
              </div>
              <p className={own.fitReason}>
                {item.scoreReason || "No qualification notes were provided."}
              </p>
            </div>
          )}
        </section>

        <section
          className={`${own.detailCard} ${own.businessCard}`}
          aria-label="Business information"
        >
          <div className={own.sectionHeading}>
            <div>
              <p className={own.sectionEyebrow}>Company</p>
              <h2>Business information</h2>
            </div>
          </div>
          <dl className={own.settingsList}>
            <div>
              <dt>Location</dt>
              <dd>{item.address ?? none}</dd>
            </div>
            <div>
              <dt>Website</dt>
              <dd>
                {!item.website ? (
                  none
                ) : site ? (
                  <a
                    className={own.siteLink}
                    href={site}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {item.website}
                  </a>
                ) : (
                  item.website
                )}
              </dd>
            </div>
            <div className={own.ratingRow}>
              <dt>Public rating</dt>
              <dd>
                {item.rating === null ? (
                  none
                ) : (
                  <>
                    <strong>{item.rating.toFixed(1)}</strong>
                    <span className={own.ratingOutOf}> / 5</span>
                  </>
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section
          className={`${own.detailCard} ${own.contactCard}`}
          aria-label="Contact details"
        >
          <div className={own.sectionHeading}>
            <div>
              <p className={own.sectionEyebrow}>Reach out</p>
              <h2>Contact details</h2>
            </div>
          </div>
          <div className={own.contactGroup}>
            <h3>Email addresses</h3>
            {item.emails.length > 0 ? (
              <ul className={own.detailList}>
                {item.emails.map((email) => (
                  <li key={email}>
                    <a href={`mailto:${email}`}>{email}</a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={own.detailNone}>
                {enrichmentText[item.enrichmentStatus]}
              </p>
            )}
            {item.enrichmentError && (
              <p className={own.enrichmentError}>{item.enrichmentError}</p>
            )}
          </div>
          <div className={own.contactGroup}>
            <h3>Phone numbers</h3>
            {item.phones.length > 0 ? (
              <ul className={own.detailList}>
                {item.phones.map((phone) => (
                  <li key={phone}>
                    <a href={`tel:${phone}`}>{phone}</a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={own.detailNone}>No phone numbers found.</p>
            )}
          </div>
        </section>

        <section
          className={`${own.detailCard} ${own.socialCard}`}
          aria-label="Social profiles"
        >
          <div className={own.sectionHeading}>
            <div>
              <p className={own.sectionEyebrow}>Online presence</p>
              <h2>Social profiles</h2>
            </div>
          </div>
          {socials.length > 0 ? (
            <dl className={own.settingsList}>
              {socials.map((group) => (
                <div key={group.platform}>
                  <dt>{group.platform}</dt>
                  {group.urls.map((url) => (
                    <dd key={url}>
                      <a
                        className={own.siteLink}
                        href={url}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {url.replace(/^https?:\/\/(www\.)?/, "")}
                      </a>
                    </dd>
                  ))}
                </div>
              ))}
            </dl>
          ) : (
            <p className={own.detailNone}>No social profiles found.</p>
          )}
        </section>

        {item.duplicateKind && (
          <section
            className={`${own.detailCard} ${own.detailWide}`}
            aria-label="Possible duplicate"
          >
            <div className={own.sectionHeading}>
              <div>
                <p className={own.sectionEyebrow}>Record check</p>
                <h2>Possible duplicate</h2>
              </div>
            </div>
            <p>
              This looks like {duplicateText[item.duplicateKind]}.
              {item.duplicateReason ? ` ${item.duplicateReason}` : ""}
            </p>
          </section>
        )}

        <section
          className={`${own.detailCard} ${own.detailWide} ${own.outreachCard}`}
          aria-label="Outreach messages"
        >
          <div className={own.sectionHeading}>
            <div>
              <p className={own.sectionEyebrow}>Sales workspace</p>
              <h2>Outreach messages</h2>
            </div>
            {drafts?.some(
              (draft) =>
                draft.status === "pending" || draft.status === "approved",
            ) ? (
              <Link className={ui.secondaryButton} href="/sales/approvals">
                Review drafts
              </Link>
            ) : (
              <button
                className={ui.button}
                type="button"
                onClick={generateDraft}
                disabled={
                  drafting || drafts === null || item.emails.length === 0
                }
              >
                {drafting
                  ? "Drafting…"
                  : drafts === null
                    ? "Loading drafts…"
                    : item.emails.length === 0
                      ? "No email address"
                      : "Generate email draft"}
              </button>
            )}
          </div>
          <p className={own.outreachExplanation}>
            Drafts are reviewed in Sales. Approving a draft does not send the
            email.
          </p>
          {draftError && (
            <div className={own.draftFailure}>
              <p>{draftError}</p>
              <button
                className={ui.secondaryButton}
                type="button"
                onClick={loadDrafts}
              >
                Try again
              </button>
            </div>
          )}
          {draftNotice && <p className={own.draftNotice}>{draftNotice}</p>}
          {drafts === null ? (
            <p className={own.detailNone}>Loading outreach messages…</p>
          ) : drafts.length > 0 ? (
            <div className={own.draftList}>
              {drafts.map((draft) => (
                <article className={own.draftCard} key={draft.id}>
                  <div className={own.draftMeta}>
                    <span
                      className={own.draftStatus}
                      data-status={draft.status}
                    >
                      {draft.status === "pending"
                        ? "Awaiting review"
                        : draft.status === "approved"
                          ? "Approved"
                          : "Not approved"}
                    </span>
                    <span>
                      {draft.method === "ai" ? "AI drafted" : "Standard draft"}
                    </span>
                    <span>
                      {new Date(draft.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className={own.draftRecipient}>
                    To: {draft.recipientEmail}
                  </p>
                  <h3 className={own.draftSubject}>{draft.subject}</h3>
                  <p className={own.draftBody}>{draft.body}</p>
                  {draft.rejectedReason && (
                    <p className={own.detailNone}>
                      Review note: {draft.rejectedReason}
                    </p>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className={own.messageEmpty}>
              <span className={own.messageMark} aria-hidden="true">
                ✉
              </span>
              <div>
                <h3>No messages generated yet</h3>
                <p>
                  Create a personalized email draft from this business’s public
                  details and campaign.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
