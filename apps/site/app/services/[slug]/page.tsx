import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  allServices,
  clearance,
  faqs as siteFaqs,
  processSteps,
  serviceGroups,
} from "../../content";
import { Icon } from "../../Icon";
import { JsonLd } from "../../JsonLd";
import {
  breadcrumbJsonLd,
  faqJsonLd,
  pageMetadata,
  serviceJsonLd,
} from "../../seo";
import { CtaBand, PageHero, SectionHeading } from "../../Sections";
import { serviceDetails, serviceHref } from "../../serviceDetails";

// Only services with an entry in serviceDetails get a page; anything else 404s.
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(serviceDetails).map((slug) => ({ slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!Object.hasOwn(serviceDetails, slug)) return {};
  const detail = serviceDetails[slug];
  return pageMetadata({
    title: detail.seoTitle,
    description: detail.description,
    path: `/services/${slug}`,
  });
}

// Answers for the customs page come from the shared site FAQs so the
// clearance time and charges are written in one place only.
const clearanceFaqs = siteFaqs.filter((faq) =>
  [
    "How long does customs clearance",
    "Which documents do I need",
    "How are customs duty",
  ].some((start) => faq.question.startsWith(start)),
);
const quoteFaq = siteFaqs.find((faq) =>
  faq.question.startsWith("What do you need to give me a quote"),
);

export default async function ServicePage({ params }: Props) {
  const { slug } = await params;
  const service = allServices.find((item) => item.slug === slug);
  if (!service || !Object.hasOwn(serviceDetails, slug)) notFound();
  const detail = serviceDetails[slug];

  const faqs = [
    ...detail.faqs,
    ...(slug === "customs-clearance" ? clearanceFaqs : []),
    ...(quoteFaq ? [quoteFaq] : []),
  ];

  // Same-group services first, then the rest; only those that have a page.
  const group = serviceGroups.find((item) =>
    item.services.some((candidate) => candidate.slug === slug),
  );
  const related = [
    ...(group?.services ?? []),
    ...allServices.filter((item) => !group?.services.includes(item)),
  ]
    .filter(
      (item) => item.slug !== slug && Object.hasOwn(serviceDetails, item.slug),
    )
    .slice(0, 3);

  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Services", path: "/services" },
    { name: service.title, path: `/services/${slug}` },
  ];

  return (
    <>
      <JsonLd
        data={[
          serviceJsonLd(service),
          breadcrumbJsonLd(crumbs),
          faqJsonLd(faqs),
        ]}
      />
      <PageHero eyebrow="Services" title={detail.h1}>
        {detail.intro}
      </PageHero>

      <nav className="crumbs container" aria-label="Breadcrumb">
        <ol>
          <li>
            <Link href="/">Home</Link>
          </li>
          <li>
            <Link href="/services">Services</Link>
          </li>
          <li aria-current="page">{service.title}</li>
        </ol>
      </nav>

      <section className="section">
        <div className="container split">
          <div className="reveal from-left">
            <p className="eyebrow">What is included</p>
            <h2>{service.title} with BJH Logistics</h2>
            <ul className="included">
              {detail.includes.map((item) => (
                <li key={item}>
                  <Icon name="check" size={18} /> {item}
                </li>
              ))}
            </ul>
            <Link
              href={`/request-a-quote?service=${slug}`}
              className="btn btn-primary"
            >
              Get a quote <Icon name="arrow" size={18} />
            </Link>
          </div>
          {service.image ? (
            <Image
              src={service.image}
              alt={`Illustrative ${service.title.toLowerCase()} scene`}
              width={1200}
              height={650}
              className="service-detail-media reveal from-right"
            />
          ) : null}
        </div>
      </section>

      {slug === "customs-clearance" ? (
        <section className="section tinted">
          <div className="container split">
            <div className="reveal from-left">
              <p className="eyebrow">Tema Port clearance</p>
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
                Customs duty is charged at cost, based on the HS code and value
                of the goods. Shipping line and port terminal charges are also
                charged at cost in your quotation.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section
        className={`section${slug === "customs-clearance" ? "" : " tinted"}`}
      >
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

      <section
        className={`section${slug === "customs-clearance" ? " tinted" : ""}`}
      >
        <div className="container faq-layout">
          <div className="reveal from-left">
            <p className="eyebrow">Questions</p>
            <h2>{service.title}: common questions</h2>
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

      {related.length ? (
        <section
          className={`section${slug === "customs-clearance" ? "" : " tinted"}`}
        >
          <div className="container">
            <SectionHeading
              eyebrow="Related services"
              title="Often combined with"
            />
            <div className="card-grid">
              {related.map((item, index) => (
                <article
                  key={item.slug}
                  className="service-card reveal"
                  style={{ transitionDelay: `${index * 90}ms` }}
                >
                  <span className="icon-box">
                    <Icon name={item.icon} />
                  </span>
                  <h3>
                    <Link href={serviceHref(item.slug)}>{item.title}</Link>
                  </h3>
                  <p>{item.summary}</p>
                  <Link href={serviceHref(item.slug)} className="card-link">
                    Learn more <Icon name="arrow" size={16} />
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <CtaBand />
    </>
  );
}
