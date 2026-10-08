"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createQuoteRequest } from "./quoteRequestApi";
import { useStaffAccess } from "../auth/useStaffAccess";
import styles from "./quotation.module.css";
import { ErrorPopup } from "../ErrorPopup";

type RequestDraft = {
  companyName: string;
  contactName: string;
  email: string;
  message: string;
};

const emptyDraft: RequestDraft = {
  companyName: "",
  contactName: "",
  email: "",
  message: "",
};

export function RequestComposer() {
  const { status, isSuperAdmin } = useStaffAccess();
  const router = useRouter();
  const [draft, setDraft] = useState(emptyDraft);
  const [preview, setPreview] = useState<RequestDraft | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const companyInput = useRef<HTMLInputElement>(null);
  const contactInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const messageInput = useRef<HTMLTextAreaElement>(null);

  if (status === "loading") {
    return <p role="status">Checking staff access…</p>;
  }
  if (!isSuperAdmin) {
    return (
      <section className={styles.composerPanel}>
        <p role="status">
          {status === "unavailable"
            ? "Staff access could not be checked. Try again when the API is available."
            : "Only the super admin can create quote requests."}
        </p>
      </section>
    );
  }

  function previewRequest() {
    const fields = [
      companyInput.current,
      contactInput.current,
      emailInput.current,
      messageInput.current,
    ];
    const invalidField = fields.find(
      (field) => field && !field.checkValidity(),
    );

    if (invalidField) {
      invalidField.reportValidity();
      return;
    }

    setPreview({ ...draft });
  }

  function clearDraft() {
    setDraft(emptyDraft);
    setPreview(null);
    setSubmitError("");
  }

  async function submitRequest() {
    if (!preview || submitting) {
      return;
    }

    setSubmitting(true);
    setSubmitError("");
    try {
      const created = await createQuoteRequest(preview);
      router.push(`/quotations/requests/${created.id}`);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "The request could not be saved",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (preview) {
    return (
      <section className={styles.composerPanel} aria-labelledby="preview-title">
        <div className={styles.previewSuccess}>
          <span aria-hidden="true">1</span>
          <div>
            <h2 id="preview-title">Review request</h2>
            <p>Check these details before saving the request.</p>
          </div>
        </div>
        <dl className={styles.previewDetails}>
          <div>
            <dt>Company</dt>
            <dd>{preview.companyName}</dd>
          </div>
          <div>
            <dt>Contact</dt>
            <dd>{preview.contactName}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{preview.email}</dd>
          </div>
          <div className={styles.previewMessage}>
            <dt>Request details</dt>
            <dd>{preview.message}</dd>
          </div>
        </dl>
        <ErrorPopup message={submitError} />
        <div className={styles.formActions}>
          <button
            className={styles.secondaryButton}
            onClick={() => setPreview(null)}
            type="button"
          >
            Edit preview
          </button>
          <button
            className={styles.primaryButton}
            disabled={submitting}
            onClick={() => void submitRequest()}
            type="button"
          >
            {submitting ? "Saving…" : "Submit request"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.composerPanel} aria-labelledby="fields-title">
      <div className={styles.composerHeader}>
        <div>
          <p className={styles.sectionEyebrow}>REQUEST INTAKE</p>
          <h2 id="fields-title">Request details</h2>
        </div>
      </div>

      <fieldset className={styles.requestFields}>
        <legend>Contact and request</legend>
        <div className={styles.formGrid}>
          <label className={styles.formField} htmlFor="request-company">
            Company name <span aria-hidden="true">*</span>
            <input
              autoComplete="off"
              id="request-company"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  companyName: event.target.value,
                }))
              }
              placeholder="Example Demo Company"
              ref={companyInput}
              required
              value={draft.companyName}
            />
          </label>
          <label className={styles.formField} htmlFor="request-contact">
            Contact name <span aria-hidden="true">*</span>
            <input
              autoComplete="off"
              id="request-contact"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  contactName: event.target.value,
                }))
              }
              placeholder="Alex Demo"
              ref={contactInput}
              required
              value={draft.contactName}
            />
          </label>
          <label className={styles.formField} htmlFor="request-email">
            Email address <span aria-hidden="true">*</span>
            <input
              autoComplete="off"
              id="request-email"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  email: event.target.value,
                }))
              }
              placeholder="alex@example.test"
              ref={emailInput}
              required
              type="email"
              value={draft.email}
            />
          </label>
          <label
            className={`${styles.formField} ${styles.fullWidth}`}
            htmlFor="request-message"
          >
            How can BJH help? <span aria-hidden="true">*</span>
            <textarea
              id="request-message"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  message: event.target.value,
                }))
              }
              placeholder="Enter fictional sample details for the UI preview"
              ref={messageInput}
              required
              rows={5}
              value={draft.message}
            />
          </label>
        </div>
      </fieldset>

      <div className={styles.formActions}>
        <button
          className={styles.primaryButton}
          onClick={previewRequest}
          type="button"
        >
          Review request
        </button>
        <button
          className={styles.textButton}
          onClick={clearDraft}
          type="button"
        >
          Clear fields
        </button>
      </div>
    </section>
  );
}
