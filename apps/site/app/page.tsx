import Link from "next/link";
import Image from "next/image";
import {
  affiliations,
  allServices,
  benefits,
  carriers,
  contact,
  faqs,
  featuredServices,
  FOUNDED,
  processSteps,
  projects,
  whatsappHref,
} from "./content";
import { Icon } from "./Icon";
import { CtaBand, SectionHeading } from "./Sections";

const yearsInBusiness = new Date().getFullYear() - FOUNDED;

export default function HomePage() {
  const marquee = [...carriers.sea, ...carriers.air, ...affiliations];

  return (
    <>
      <section className="hero">
        <div className="hero-grid" aria-hidden="true" />
        <div className="container hero-inner">
          <div className="hero-copy">
            <p className="eyebrow light">Since {FOUNDED} · Tema, Ghana</p>
            <h1>
              Freight, customs and logistics, <span>handled end to end.</span>
            </h1>
            <p className="lead">
              BJH Logistics moves your cargo by air, sea and land. We book it,
              clear it, store it and deliver it, so you deal with one team from
              origin to door.
            </p>
            <div className="hero-actions">
              <Link href="/request-a-quote" className="btn btn-white">
                Request a quote <Icon name="arrow" size={18} />
              </Link>
              <a
                href={whatsappHref()}
                className="btn btn-outline-white"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="whatsapp" size={18} /> Talk to the team
              </a>
            </div>
            <ul className="hero-pills">
              <li>
                <Icon name="plane" size={18} /> Air
              </li>
              <li>
                <Icon name="ship" size={18} /> Sea
              </li>
              <li>
                <Icon name="truck" size={18} /> Land
              </li>
              <li>
                <Icon name="project" size={18} /> Project cargo
              </li>
            </ul>
          </div>
          <div className="hero-visual">
            <Image
              src="/images/tema-port-editorial.webp"
              alt="Illustrative view of a container vessel and port operations"
              width={1983}
              height={793}
              priority
            />
          </div>
        </div>
        <a href="#stats" className="scroll-cue" aria-label="Scroll down">
          <span />
        </a>
      </section>

      <section id="stats" className="stats">
        <div className="container stats-grid">
          {[
            { value: yearsInBusiness, suffix: "+", label: "Years in business" },
            {
              value: allServices.length,
              suffix: "",
              label: "Logistics services",
            },
            { value: 3, suffix: "", label: "Modes: air, sea and land" },
            {
              value: affiliations.length,
              suffix: "",
              label: "Industry affiliations",
            },
          ].map((stat, index) => (
            <div
              key={stat.label}
              className="stat reveal"
              style={{ transitionDelay: `${index * 80}ms` }}
            >
              <p className="stat-value">
                <span data-count={stat.value}>{stat.value}</span>
                {stat.suffix}
              </p>
              <p className="stat-label">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeading
            eyebrow="What we do"
            title="Logistics services for importers and exporters"
          >
            From a single pallet to a full project shipment, we plan the route,
            prepare the documents and keep your cargo moving.
          </SectionHeading>
          <div className="card-grid">
            {featuredServices.map((service, index) => (
              <Link
                key={service.slug}
                href={`/services#${service.slug}`}
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
                <span className="card-link">
                  Learn more <Icon name="arrow" size={16} />
                </span>
              </Link>
            ))}
          </div>
          <div className="center-action reveal">
            <Link href="/services" className="btn btn-primary">
              View all {allServices.length} services{" "}
              <Icon name="arrow" size={18} />
            </Link>
          </div>
        </div>
      </section>

      <section className="section tinted">
        <div className="container split">
          <div className="reveal from-left">
            <p className="eyebrow">Why BJH Logistics</p>
            <h2>One team for freight, customs and delivery</h2>
            <p className="section-lead">
              Working from Tema since {FOUNDED}, close to Ghana&apos;s main
              port, we know the clearance process and the people who make it
              work. You get clear answers, realistic timelines and someone who
              picks up the phone.
            </p>
            <Link href="/about" className="btn btn-primary">
              About us <Icon name="arrow" size={18} />
            </Link>
          </div>
          <div className="benefit-grid">
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
            eyebrow="How we work"
            title="Five steps from enquiry to delivery"
            center
          />
          <ol className="process reveal">
            {processSteps.map((step, index) => (
              <li
                key={step.title}
                style={{ transitionDelay: `${200 + index * 160}ms` }}
              >
                <span className="step-number">{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section dark">
        <div className="container">
          <SectionHeading
            eyebrow="Industries"
            title="Experience with complex cargo"
          >
            Mining, energy, automotive and humanitarian projects all need
            careful planning. We have handled them across Ghana and West Africa.
          </SectionHeading>
          <div className="card-grid">
            {projects.map((project, index) => (
              <div
                key={project.title}
                className="project-card reveal"
                style={{ transitionDelay: `${(index % 3) * 90}ms` }}
              >
                <span className="icon-box">
                  <Icon name={project.icon} />
                </span>
                <h3>{project.title}</h3>
                <p>{project.summary}</p>
              </div>
            ))}
          </div>
          <div className="center-action reveal">
            <Link href="/projects" className="btn btn-white">
              View projects <Icon name="arrow" size={18} />
            </Link>
          </div>
        </div>
      </section>

      <section className="partners">
        <p className="eyebrow center-text">
          Carriers we book with and industry affiliations
        </p>
        <div className="marquee" aria-label={marquee.join(", ")}>
          <div className="marquee-track" aria-hidden="true">
            {[...marquee, ...marquee].map((name, index) => (
              <span key={`${name}-${index}`}>{name}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container faq-layout">
          <div className="reveal from-left">
            <p className="eyebrow">Questions</p>
            <h2>Frequently asked questions</h2>
            <p className="section-lead">
              Can&apos;t find your answer? Email{" "}
              <a href={`mailto:${contact.enquiriesEmail}`}>
                {contact.enquiriesEmail}
              </a>
              .
            </p>
          </div>
          <div className="faq-list">
            {faqs.map((faq, index) => (
              <details
                key={faq.question}
                className="faq reveal"
                style={{ transitionDelay: `${index * 80}ms` }}
              >
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
