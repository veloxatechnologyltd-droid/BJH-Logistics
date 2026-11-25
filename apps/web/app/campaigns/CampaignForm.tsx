"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ErrorPopup } from "../ErrorPopup";
import {
  createCampaign,
  getCampaignConfig,
  startSearch,
  updateCampaign,
} from "./campaignApi";
import type { Campaign, DraftedCampaign } from "./campaignApi";
import { CampaignHelper } from "./CampaignHelper";
import {
  joinWords,
  parseWords,
  ratingSteps,
  startSearchWarning,
} from "./campaignView";
import ui from "../jobs/jobs.module.css";
import own from "./campaigns.module.css";

type Props = {
  /** Present when editing; absent when creating. */
  campaign?: Campaign;
  /** Creating only: what the AI filled in. The person still checks it and starts the search. */
  draft?: DraftedCampaign;
  onSaved: (campaign: Campaign) => void;
  onCancel?: () => void;
  /** Shown beside the button that starts a search, when the search is charged. */
  searchNote?: string;
};

/** What to look for, how to narrow it, and how to judge a fit. Used to create and to edit. */
export function CampaignForm({
  campaign,
  draft,
  onSaved,
  onCancel,
  searchNote,
}: Props) {
  const initial: DraftedCampaign | undefined = campaign ?? draft;
  const [name, setName] = useState(initial?.name ?? "");
  const [service, setService] = useState(initial?.targetService ?? "");
  const [industry, setIndustry] = useState(initial?.targetIndustry ?? "");
  const [location, setLocation] = useState(initial?.targetLocation ?? "");
  const [keywords, setKeywords] = useState(
    joinWords(initial?.searchKeywords ?? []),
  );
  const [excluded, setExcluded] = useState(
    joinWords(initial?.excludedKeywords ?? []),
  );
  const [minRating, setMinRating] = useState(
    initial?.minRating === null || initial?.minRating === undefined
      ? ""
      : String(initial.minRating),
  );
  const [requireWebsite, setRequireWebsite] = useState(
    initial?.requireWebsite ?? false,
  );
  const [ideal, setIdeal] = useState(initial?.idealCustomerProfile ?? "");
  const [disqualifiers, setDisqualifiers] = useState(
    initial?.disqualifiers ?? "",
  );
  const [generateEmails, setGenerateEmails] = useState(
    initial?.generateEmails ?? false,
  );
  const [emailContext, setEmailContext] = useState(initial?.emailContext ?? "");
  const [emailCta, setEmailCta] = useState(initial?.emailCta ?? "");
  const [threshold, setThreshold] = useState(
    String(initial?.qualificationThreshold ?? 50),
  );
  const [maxProspects, setMaxProspects] = useState(
    String(initial?.maxProspects ?? 500),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const input = {
      name,
      targetService: service,
      targetIndustry: industry,
      targetLocation: location,
      searchKeywords: parseWords(keywords),
      excludedKeywords: parseWords(excluded),
      minRating: minRating === "" ? null : Number(minRating),
      requireWebsite,
      idealCustomerProfile: ideal.trim() || null,
      disqualifiers: disqualifiers.trim() || null,
      generateEmails,
      emailContext: emailContext.trim() || null,
      emailCta: emailCta.trim() || null,
      qualificationThreshold: Number(threshold),
      maxProspects: Number(maxProspects),
    };
    try {
      if (campaign) {
        onSaved(await updateCampaign(campaign.id, input));
      } else {
        const created = await createCampaign(input);
        // Creating a campaign also starts its search. If only the search fails, the campaign
        // exists and its page offers "Find businesses" again.
        await startSearch(created.id).catch(() => undefined);
        onSaved(created);
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The campaign was not saved",
      );
      setBusy(false);
    }
  }

  return (
    <form className={ui.form} onSubmit={submit}>
      <ErrorPopup message={error} />

      <fieldset className={own.fieldset}>
        <legend>What to look for</legend>
        <div className={ui.grid}>
          <Field
            help="For your own list, such as “Food importers in Accra”."
            label="Campaign name"
          >
            {(props) => (
              <input
                {...props}
                maxLength={160}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            )}
          </Field>
          <Field
            help="For example “Sea freight import”."
            label="Service to offer"
          >
            {(props) => (
              <input
                {...props}
                maxLength={160}
                onChange={(event) => setService(event.target.value)}
                required
                value={service}
              />
            )}
          </Field>
          <Field
            help="For example “Food importers”. This is what gets searched."
            label="Kind of business"
          >
            {(props) => (
              <input
                {...props}
                maxLength={160}
                onChange={(event) => setIndustry(event.target.value)}
                required
                value={industry}
              />
            )}
          </Field>
          <Field
            help="A town and country, such as “Accra, Ghana”."
            label="Where"
          >
            {(props) => (
              <input
                {...props}
                maxLength={160}
                onChange={(event) => setLocation(event.target.value)}
                required
                value={location}
              />
            )}
          </Field>
        </div>
      </fieldset>

      <details className={own.more} open={draft ? true : undefined}>
        <summary>
          More options: words, rating, how many to find, and how to judge a fit
        </summary>
        <fieldset className={own.fieldset}>
          <legend>How to narrow the search</legend>
          <div className={ui.grid}>
            <Field
              help="One per line. Leave empty to search for the kind of business above."
              label="Words to search for (optional)"
            >
              {(props) => (
                <textarea
                  {...props}
                  onChange={(event) => setKeywords(event.target.value)}
                  rows={3}
                  value={keywords}
                />
              )}
            </Field>
            <Field
              help="One per line. A business whose name, type, address or website has one of these is left out."
              label="Words to skip (optional)"
            >
              {(props) => (
                <textarea
                  {...props}
                  onChange={(event) => setExcluded(event.target.value)}
                  rows={3}
                  value={excluded}
                />
              )}
            </Field>
            <Field label="Lowest public rating">
              {(props) => (
                <select
                  {...props}
                  onChange={(event) => setMinRating(event.target.value)}
                  value={minRating}
                >
                  <option value="">Any rating</option>
                  {ratingSteps.map((step) => (
                    <option key={step} value={step}>
                      {step.toFixed(1)} stars or more
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field
              help="From 1 to 500. A real search is charged by the business found, about US$0.01 each. You may get fewer than this: it is the most to keep, not a number to reach."
              label="Most businesses to find"
            >
              {(props) => (
                <input
                  {...props}
                  max={500}
                  min={1}
                  onChange={(event) => setMaxProspects(event.target.value)}
                  required
                  step={1}
                  type="number"
                  value={maxProspects}
                />
              )}
            </Field>
          </div>
          <label className={own.checkLabel}>
            <input
              checked={requireWebsite}
              onChange={(event) => setRequireWebsite(event.target.checked)}
              type="checkbox"
            />
            Only businesses that have a website
          </label>
        </fieldset>

        <fieldset className={own.fieldset}>
          <legend>How to judge a fit</legend>
          <div className={ui.grid}>
            <Field
              help="In your own words, for example “Regular importers who ship full containers every month”."
              label="The ideal customer (optional)"
            >
              {(props) => (
                <textarea
                  {...props}
                  maxLength={2000}
                  onChange={(event) => setIdeal(event.target.value)}
                  rows={3}
                  value={ideal}
                />
              )}
            </Field>
            <Field
              help="For example “freight forwarders, shipping lines, individuals”. A business like this scores very low."
              label="Not a fit (optional)"
            >
              {(props) => (
                <textarea
                  {...props}
                  maxLength={2000}
                  onChange={(event) => setDisqualifiers(event.target.value)}
                  rows={3}
                  value={disqualifiers}
                />
              )}
            </Field>
            <Field
              help="From 0 to 100. A business at or above this is a good fit."
              label="Score that counts as a good fit"
            >
              {(props) => (
                <input
                  {...props}
                  max={100}
                  min={0}
                  onChange={(event) => setThreshold(event.target.value)}
                  required
                  step={1}
                  type="number"
                  value={threshold}
                />
              )}
            </Field>
          </div>
        </fieldset>
      </details>

      <fieldset className={own.fieldset}>
        <legend>What the search should do</legend>
        <label className={own.checkLabel}>
          <input
            checked={!generateEmails}
            name="searchMode"
            onChange={() => setGenerateEmails(false)}
            type="radio"
          />
          Find leads only
        </label>
        <label className={own.checkLabel}>
          <input
            checked={generateEmails}
            name="searchMode"
            onChange={() => setGenerateEmails(true)}
            type="radio"
          />
          Find leads and write a first email for each good fit
        </label>
        {generateEmails && (
          <>
            <p className={own.help}>
              Emails are only drafted for you to read, edit and approve in
              Sales. Nothing is sent. The writer already knows BJH from the
              knowledge base in Settings, so you only need to say what is
              special about this campaign.
            </p>
            <div className={ui.grid}>
              <Field
                help="What to emphasise for these businesses, such as the route or service that fits them. Leave empty to use the knowledge base alone. Say what it must not mention."
                label="Context for the email (optional)"
              >
                {(props) => (
                  <textarea
                    {...props}
                    maxLength={2000}
                    onChange={(event) => setEmailContext(event.target.value)}
                    placeholder="For example: These are car importers, so lead with the weekly Antwerp to Tema sailing and port clearance. Do not mention prices."
                    rows={5}
                    value={emailContext}
                  />
                )}
              </Field>
              <Field
                help="The one thing you want the reader to do. Leave empty for a simple question."
                label="Call to action (optional)"
              >
                {(props) => (
                  <textarea
                    {...props}
                    maxLength={500}
                    onChange={(event) => setEmailCta(event.target.value)}
                    placeholder="For example: Reply to this email to get a quote, or to book a 15 minute call this week."
                    rows={2}
                    value={emailCta}
                  />
                )}
              </Field>
            </div>
          </>
        )}
      </fieldset>

      <div className={ui.formActions}>
        <button className={ui.button} disabled={busy} type="submit">
          {busy
            ? campaign
              ? "Saving…"
              : "Starting…"
            : campaign
              ? "Save changes"
              : "Find businesses"}
        </button>
        {onCancel && (
          <button
            className={ui.secondaryButton}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        )}
      </div>
      {!campaign && searchNote && <p className={own.help}>{searchNote}</p>}
    </form>
  );
}

/**
 * A labelled field. The help text sits beside the label, not inside it, so a screen
 * reader says the label as the field's name and reads the help as its description.
 */
function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: (props: { id: string; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className={ui.field}>
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-describedby": help ? helpId : undefined })}
      {help && (
        <span className={own.help} id={helpId}>
          {help}
        </span>
      )}
    </div>
  );
}

/** The page's form: creating starts the search, then goes to the new campaign. */
export function NewCampaignForm() {
  const router = useRouter();
  const [charged, setCharged] = useState(false);
  useEffect(() => {
    getCampaignConfig()
      .then((config) => setCharged(!config.sampleData))
      .catch(() => undefined);
  }, []);
  // A new key starts the form again from the AI's draft.
  const [draft, setDraft] = useState<{
    campaign: DraftedCampaign;
    assumptions: string[];
    key: number;
  } | null>(null);
  return (
    <>
      <CampaignHelper
        onDraft={(campaign, assumptions) =>
          setDraft((last) => ({
            campaign,
            assumptions,
            key: (last?.key ?? 0) + 1,
          }))
        }
      />
      <CampaignForm
        key={draft?.key ?? 0}
        draft={draft?.campaign}
        searchNote={charged ? startSearchWarning : undefined}
        onCancel={() => router.push("/campaigns")}
        onSaved={(campaign) => router.push(`/campaigns/${campaign.id}`)}
      />
    </>
  );
}
