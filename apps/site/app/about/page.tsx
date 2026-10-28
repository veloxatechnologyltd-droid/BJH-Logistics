import type { Metadata } from "next";
import {
  affiliations,
  benefits,
  carriers,
  differentiators,
  FOUNDED,
} from "../content";
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
        BJH Logistics Services Ltd. is a freight forwarding and logistics
        company based in Tema, Ghana, with project cargo and offshore support
        across West Africa.
      </PageHero>

      <section className="section">
        <div className="container split">
          <div className="reveal from-left">
            <p className="eyebrow">Who we are</p>
            <h2>Close to the port, close to our customers</h2>
            <p className="section-lead">
              From our office in Tema Community 1, a short distance from Tema
              Port, we arrange air, sea and road freight, clear cargo through
              customs, store it and deliver it. Importers, exporters and project
              teams rely on us to handle the whole chain so they can focus on
              their business.
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
            eyebrow="Network"
            title="Carriers and affiliations"
            center
          />
          <div className="network-grid">
            {[
              {
                title: "Ocean carriers",
                names: carriers.sea,
                icon: "ship" as const,
              },
              {
                title: "Air carriers",
                names: carriers.air,
                icon: "plane" as const,
              },
              {
                title: "Affiliations",
                names: affiliations,
                icon: "globe" as const,
              },
            ].map((column, index) => (
              <div
                key={column.title}
                className="network-card reveal"
                style={{ transitionDelay: `${index * 100}ms` }}
              >
                <span className="icon-box">
                  <Icon name={column.icon} />
                </span>
                <h3>{column.title}</h3>
                <ul>
                  {column.names.map((name) => (
                    <li key={name}>{name}</li>
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
