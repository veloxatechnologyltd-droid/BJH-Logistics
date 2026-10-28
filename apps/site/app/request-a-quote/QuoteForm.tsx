"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
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

  const field = (key: keyof QuoteDetails) => ({
    name: key,
    value: details[key],
    onChange: (event: { target: { value: string } }) =>
      setDetails((current) => ({ ...current, [key]: event.target.value })),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    window.location.href = quoteMailto(contact.quotesEmail, details);
    setSent(true);
  };

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
            placeholder="Type of goods, packaging, quantity"
            {...field("cargo")}
          />
        </label>
        <div className="form-row">
          <label>
            Weight, dimensions or container
            <input
              placeholder="e.g. 1,200 kg, 3 pallets or 1 x 40ft"
              {...field("weight")}
            />
          </label>
          <label>
            Cargo ready date
            <input type="date" {...field("readyDate")} />
          </label>
        </div>
        <label>
          Anything else?
          <textarea
            rows={3}
            placeholder="Customs clearance, delivery address, insurance…"
            {...field("notes")}
          />
        </label>
      </fieldset>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary">
          Send by email <Icon name="arrow" size={18} />
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
        {sent
          ? `Your email app should now be open with your request to ${contact.quotesEmail}. Press send there to finish.`
          : `"Send by email" opens your email app with the request addressed to ${contact.quotesEmail}.`}
      </p>
    </form>
  );
}
