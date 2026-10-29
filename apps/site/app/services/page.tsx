import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { clearance, serviceGroups } from "../content";
import { Icon } from "../Icon";
import { CtaBand, PageHero } from "../Sections";

export const metadata: Metadata = {
  title: "Services",
  description:
    "Sea, air and road freight, customs clearance at Tema Port, warehousing and bonded storage, container sales, cargo insurance and project cargo from Tema, Ghana.",
};

export default function ServicesPage() {
  return (
    <>
      <PageHero
        eyebrow="Services"
        title="Everything your cargo needs, from one team"
      >
        Freight, customs, storage and specialist cargo, planned together so your
        shipment keeps moving.
      </PageHero>

      {serviceGroups.map((group, groupIndex) => (
        <section
          key={group.title}
          className={`section${groupIndex % 2 ? " tinted" : ""}`}
        >
          <div className="container">
            <div className="section-heading reveal">
              <p className="eyebrow">
                {String(groupIndex + 1).padStart(2, "0")}
              </p>
              <h2>{group.title}</h2>
            </div>
            <div className="card-grid">
              {group.services.map((service, index) => (
                <article
                  key={service.slug}
                  id={service.slug}
                  className="service-card reveal"
                  style={{ transitionDelay: `${(index % 3) * 90}ms` }}
                >
                  {service.image && (
                    <Image
                      src={service.image}
                      alt={`Illustrative ${service.title.toLowerCase()} scene`}
                      width={1200}
                      height={650}
                      className="service-card-image"
                    />
                  )}
                  <span className="icon-box">
                    <Icon name={service.icon} />
                  </span>
                  <h3>{service.title}</h3>
                  <p>{service.summary}</p>
                  <Link
                    href={`/request-a-quote?service=${service.slug}`}
                    className="card-link"
                  >
                    Get a quote <Icon name="arrow" size={16} />
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>
      ))}

      <section id="tema-port-clearance" className="section tinted">
        <div className="container split">
          <div className="reveal from-left">
            <p className="eyebrow">Customs clearance at Tema Port</p>
            <h2>
              Cleared and delivered in{" "}
              <span className="nowrap">{clearance.days} business days</span>
            </h2>
            <p className="section-lead">
              {clearance.scope} The time runs from cargo arrival, provided the
              required documents are available and normal port and customs
              processes apply.
            </p>
            <ol className="clearance-steps">
              {clearance.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
          <div className="differentiators">
            {clearance.documents.map((document, index) => (
              <div
                key={document.name}
                className="differentiator reveal"
                style={{ transitionDelay: `${index * 100}ms` }}
              >
                <span className="check">
                  <Icon name="license" size={18} />
                </span>
                <div>
                  <h3>{document.name}</h3>
                  <p>{document.purpose}</p>
                </div>
              </div>
            ))}
            <p className="clearance-note reveal">
              Customs duty is charged at cost, based on the HS code and value of
              the goods. Shipping line and port terminal charges are also
              charged at cost in your quotation.
            </p>
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
