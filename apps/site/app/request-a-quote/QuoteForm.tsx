"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { allServices, contact, whatsappHref } from "../content";
import { Icon } from "../Icon";
import { quoteMailto, quoteText, type QuoteDetails } from "./quoteEmail";

const empty: QuoteDetails = {
  name: "",
  company: "",
  email: "",
  phone: "",
  service: "",
  origin: "",
  destination: "",
  cargo: "",
  weight: "",
  readyDate: "",
  notes: "",
};

export function QuoteForm() {
  const serviceSlug = useSearchParams().get("service");
  const preselected = allServices.find(
    (service) => service.slug === serviceSlug,
  );
  const [details, setDetails] = useState<QuoteDetails>({
    ...empty,
    service: preselected?.title ?? "",
  });
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const confirmation = useRef<HTMLHeadingElement>(null);

  // The form is long, so the sender may be scrolled well down the page when it
  // is sent. Bring the confirmation into view and announce it.
  useEffect(() => {
    if (!sent) return;
    confirmation.current?.scrollIntoView({ block: "center" });
    confirmation.current?.focus({ preventScroll: true });
  }, [sent]);

  const field = (key: keyof QuoteDetails) => ({
    name: key,
    value: details[key],
    onChange: (event: { target: { value: string } }) =>
      setDetails((current) => ({ ...current, [key]: event.target.value })),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setError(false);
    try {
      const response = await fetch("/api/quote-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(details),
      });
      if (!response.ok) throw new Error("Request not received");
      setSent(true);
    } catch {
      setError(true);
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="quote-form quote-sent">
        <span className="quote-sent-icon">
          <Icon name="check" size={32} />
        </span>
        <h2 ref={confirmation} tabIndex={-1}>
          Request received
        </h2>
        <p>
          Thank you, {details.name.trim().split(/\s+/)[0]}. Your quote request
          is with the BJH Logistics team. We will review it and get back to you
          at <strong>{details.email}</strong>.
        </p>
      </div>
    );
  }

  return (
    <form className="quote-form" onSubmit={submit}>
      <fieldset>
        <legend>Your details</legend>
        <div className="form-row">
          <label>
            Full name *
            <input required autoComplete="name" {...field("name")} />
          </label>
          <label>
            Company
            <input autoComplete="organization" {...field("company")} />
          </label>
        </div>
        <div className="form-row">
          <label>
            Email *
            <input
              required
              type="email"
              autoComplete="email"
              {...field("email")}
            />
          </label>
          <label>
            Phone / WhatsApp
            <input type="tel" autoComplete="tel" {...field("phone")} />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Shipment</legend>
        <label>
          Service *
          <select required {...field("service")}>
            <option value="">Choose a service</option>
            {allServices.map((service) => (
              <option key={service.slug} value={service.title}>
                {service.title}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            Origin *
            <input required placeholder="City, country" {...field("origin")} />
          </label>
          <label>
            Destination *
            <input
              required
              placeholder="City, country"
              {...field("destination")}
            />
          </label>
        </div>
        <label>
          What are you shipping? *
          <textarea
            required
            rows={3}
            placeholder="Cargo type, quantity and packaging"
            {...field("cargo")}
          />
        </label>
        <div className="form-row">
          <label>
            Approximate dimensions, weight or container
            <input
              placeholder="e.g. 1,200 kg, 3 pallets or 1 x 40ft"
              {...field("weight")}
            />
          </label>
          <label>
            Preferred timing
            <input type="date" {...field("readyDate")} />
          </label>
        </div>
        <label>
          Anything else?
          <textarea
            rows={3}
            placeholder="Customs, storage, insurance or delivery support needed…"
            {...field("notes")}
          />
        </label>
      </fieldset>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={sending}>
          {sending ? "Sending…" : "Send quote request"}{" "}
          <Icon name="arrow" size={18} />
        </button>
        <a
          href={whatsappHref(
            `Hello BJH Logistics, please quote for:\n\n${quoteText(details)}`,
          )}
          className="btn btn-ghost-dark"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="whatsapp" size={18} /> Send on WhatsApp
        </a>
      </div>
      <p className="form-note" role="status">
        {error ? (
          <>
            We could not send your request. Try again, or{" "}
            <a href={quoteMailto(contact.quotesEmail, details)}>
              send it by email
            </a>
            .
          </>
        ) : (
          "Send the details directly to BJH Logistics."
        )}
      </p>
    </form>
  );
}
