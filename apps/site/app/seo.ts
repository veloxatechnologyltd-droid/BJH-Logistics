// Search and AI-answer metadata for the public site: canonical URLs, social
// cards and schema.org structured data. Everything here is built from
// content.ts, so the markup cannot drift from what the pages say.
//
// Deliberately absent: ratings, reviews, opening hours, prices, geo
// coordinates and membership claims. None is in BJH's published material, and
// search engines treat invented markup as spam. Add them only with real data.

import type { Metadata } from "next";
import {
  allServices,
  contact,
  FOUNDED,
  SITE_URL,
  telHref,
  type Service,
} from "./content.ts";
import { serviceDetails, serviceHref } from "./serviceDetails.ts";

export const SITE_NAME = "BJH Logistics";

export const SITE_DESCRIPTION =
  "BJH Logistics Services Ltd is a freight forwarding and logistics company in Tema, Ghana, operating since " +
  `${FOUNDED}. It provides sea, air and road freight, customs clearance at Tema Port, warehousing and bonded storage, ` +
  "project cargo and related services for importers and exporters.";

export const OG_IMAGE = {
  url: "/images/og-bjh-logistics.png",
  width: 1200,
  height: 630,
  alt: "BJH Logistics: freight forwarding and customs clearance in Tema, Ghana",
};

/**
 * Absolute URL for a site path. The home page has no trailing slash because
 * Next writes its canonical tag that way, and the sitemap must match it.
 */
export const absoluteUrl = (path: string) =>
  path === "/" ? SITE_URL : `${SITE_URL}${path}`;

/** Every indexable page, in sitemap order. */
export const sitePaths = [
  "/",
  "/services",
  ...Object.keys(serviceDetails).map((slug) => `/services/${slug}`),
  "/projects",
  "/about",
  "/contact",
  "/request-a-quote",
];

const organizationId = `${SITE_URL}/#organization`;

/**
 * Metadata for one page. Next replaces (not merges) the parent's openGraph and
 * twitter objects, so each page gets the full set from here.
 */
export function pageMetadata({
  title,
  description,
  path,
  absoluteTitle = false,
}: {
  title: string;
  description: string;
  path: string;
  /** Use the title as written instead of adding " | BJH Logistics". */
  absoluteTitle?: boolean;
}): Metadata {
  const fullTitle = absoluteTitle ? title : `${title} | ${SITE_NAME}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: path,
      siteName: SITE_NAME,
      locale: "en_GH",
      title: fullTitle,
      description,
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [OG_IMAGE.url],
    },
  };
}

/** JSON for a <script type="application/ld+json">; "<" is escaped so content cannot close the tag. */
export const jsonLdString = (data: object) =>
  JSON.stringify(data).replace(/</g, "\\u003c");

const e164 = (phone: string) => telHref(phone).replace(/^tel:/, "");

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": organizationId,
    name: contact.company,
    alternateName: SITE_NAME,
    url: absoluteUrl("/"),
    logo: absoluteUrl("/images/bjh-logo.png"),
    image: absoluteUrl(OG_IMAGE.url),
    description: SITE_DESCRIPTION,
    foundingDate: String(FOUNDED),
    email: contact.generalEmails[0],
    telephone: contact.phoneNumbers.map(e164),
    address: {
      "@type": "PostalAddress",
      streetAddress: `${contact.address[0]}, ${contact.address[1]}, Community 1`,
      addressLocality: "Tema",
      addressCountry: "GH",
    },
    hasMap: contact.mapUrl,
    areaServed: { "@type": "Country", name: "Ghana" },
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer service",
        telephone: e164(contact.hotline),
        email: contact.enquiriesEmail,
        areaServed: "GH",
        availableLanguage: "English",
      },
    ],
    sameAs: contact.socials.map((social) => social.href),
    knowsAbout: allServices.map((service) => service.title),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Logistics services",
      itemListElement: allServices.map((service) => ({
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: service.title,
          url: absoluteUrl(serviceHref(service.slug)),
        },
      })),
    },
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: absoluteUrl("/"),
    name: SITE_NAME,
    alternateName: contact.company,
    inLanguage: "en-GH",
    publisher: { "@id": organizationId },
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function faqJsonLd(items: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export function serviceJsonLd(service: Service) {
  const url = absoluteUrl(serviceHref(service.slug));
  const description = Object.hasOwn(serviceDetails, service.slug)
    ? serviceDetails[service.slug].description
    : service.summary;
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": `${url}#service`,
    name: service.title,
    serviceType: service.title,
    description,
    url,
    provider: { "@id": organizationId },
    areaServed: { "@type": "Country", name: "Ghana" },
  };
}
