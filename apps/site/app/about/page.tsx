import type { Metadata } from "next";
import { benefits, differentiators, serviceGroups, FOUNDED } from "../content";
import { Icon } from "../Icon";
import { CtaBand, PageHero, SectionHeading } from "../Sections";

export const metadata: Metadata = {
  title: "About us",
  description: `BJH Logistics has delivered freight forwarding, customs and logistics services from Tema, Ghana since ${FOUNDED}.`,
};

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About us"
        title={`Delivering logistics solutions since ${FOUNDED}`}
      >
        BJH Logistics Services Ltd is a Tema-based freight forwarding and
        logistics company supporting importers, exporters, project cargo teams,
        offshore operators and growing businesses.
      </PageHero>

      <section className="section">
        <div className="container split">
          <div className="reveal from-left">
            <p className="eyebrow">Who we are</p>
            <h2>Close to the port, close to our customers</h2>
            <p className="section-lead">
              We coordinate cargo movement across sea, air and land, and link it
              with customs, storage, documentation and final delivery. Our
              service model is built for customers who want one commercial
              contact to coordinate every stage of a shipment, rather than
              manage each stage separately.
            </p>
          </div>
          <div className="differentiators">
            {differentiators.map((item, index) => (
              <div
                key={item.title}
                className="differentiator reveal"
                style={{ transitionDelay: `${index * 100}ms` }}
              >
                <span className="check">
                  <Icon name="check" size={18} />
                </span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section tinted">
        <div className="container">
          <SectionHeading
            eyebrow="What you can expect"
            title="Why customers choose us"
            center
          />
          <div className="benefit-grid four">
            {benefits.map((benefit, index) => (
              <div
                key={benefit.title}
                className="benefit reveal"
                style={{ transitionDelay: `${index * 90}ms` }}
              >
                <span className="icon-box">
                  <Icon name={benefit.icon} />
                </span>
                <h3>{benefit.title}</h3>
                <p>{benefit.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeading
            eyebrow="What we coordinate"
            title="Freight, clearance and specialist support"
            center
          />
          <div className="network-grid">
            {serviceGroups.map((group, index) => (
              <div
                key={group.title}
                className="network-card reveal"
                style={{ transitionDelay: `${index * 100}ms` }}
              >
                <span className="icon-box">
                  <Icon name={group.services[0].icon} />
                </span>
                <h3>{group.title}</h3>
                <ul>
                  {group.services.map((service) => (
                    <li key={service.slug}>{service.title}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
