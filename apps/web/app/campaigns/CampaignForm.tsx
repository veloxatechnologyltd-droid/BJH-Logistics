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
import type { Campaign } from "./campaignApi";
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
  onSaved: (campaign: Campaign) => void;
  onCancel?: () => void;
  /** Shown beside the button that starts a search, when the search is charged. */
  searchNote?: string;
};

/** What to look for, how to narrow it, and how to judge a fit. Used to create and to edit. */
export function CampaignForm({
  campaign,
  onSaved,
  onCancel,
  searchNote,
}: Props) {
  const [name, setName] = useState(campaign?.name ?? "");
  const [service, setService] = useState(campaign?.targetService ?? "");
  const [industry, setIndustry] = useState(campaign?.targetIndustry ?? "");
  const [location, setLocation] = useState(campaign?.targetLocation ?? "");
  const [keywords, setKeywords] = useState(
    joinWords(campaign?.searchKeywords ?? []),
  );
  const [excluded, setExcluded] = useState(
    joinWords(campaign?.excludedKeywords ?? []),
  );
  const [minRating, setMinRating] = useState(
    campaign?.minRating === null || campaign?.minRating === undefined
      ? ""
      : String(campaign.minRating),
  );
  const [requireWebsite, setRequireWebsite] = useState(
    campaign?.requireWebsite ?? false,
  );
  const [ideal, setIdeal] = useState(campaign?.idealCustomerProfile ?? "");
  const [disqualifiers, setDisqualifiers] = useState(
    campaign?.disqualifiers ?? "",
  );
  const [generateEmails, setGenerateEmails] = useState(
    campaign?.generateEmails ?? false,
  );
  const [emailContext, setEmailContext] = useState(
    campaign?.emailContext ?? "",
  );
  const [emailCta, setEmailCta] = useState(campaign?.emailCta ?? "");
  const [threshold, setThreshold] = useState(
    String(campaign?.qualificationThreshold ?? 50),
  );
  const [maxProspects, setMaxProspects] = useState(
    String(campaign?.maxProspects ?? 50),
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
            help="From 1 to 500. A real search is charged by the business found, so start small."
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
              Sales. Nothing is sent. The more you tell the writer, the better
              the email.
            </p>
            <div className={ui.grid}>
              <Field
                help="What BJH offers these businesses and why it matters to them: the routes or services that fit, what makes BJH a good choice, and any facts you are happy to have stated. Say what it must not mention."
                label="Context for the email"
              >
                {(props) => (
                  <textarea
                    {...props}
                    maxLength={2000}
                    onChange={(event) => setEmailContext(event.target.value)}
                    placeholder="For example: BJH ships cars from Antwerp and Hamburg to Tema every week, and clears them at the port. Many importers lose time and money to port delays; we handle the paperwork. Do not mention prices."
                    required
                    rows={5}
                    value={emailContext}
                  />
                )}
              </Field>
              <Field
                help="The one thing you want the reader to do."
                label="Call to action"
              >
                {(props) => (
                  <textarea
                    {...props}
                    maxLength={500}
                    onChange={(event) => setEmailCta(event.target.value)}
                    placeholder="For example: Reply to this email to get a quote, or to book a 15 minute call this week."
                    required
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
  return (
    <CampaignForm
      searchNote={charged ? startSearchWarning : undefined}
      onCancel={() => router.push("/campaigns")}
      onSaved={(campaign) => router.push(`/campaigns/${campaign.id}`)}
    />
  );
}
