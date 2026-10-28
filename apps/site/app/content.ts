// Content taken from the current bjhlogistics.com site (October 2026).
// Descriptions marked "placeholder" were written for this rebuild and still
// need the client's confirmation.

export const FOUNDED = 2006;

export const PLATFORM_URL = (
  process.env.NEXT_PUBLIC_PLATFORM_URL ?? "http://127.0.0.1:3002"
).replace(/\/$/, "");

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://bjhlogistics.com"
).replace(/\/$/, "");

export const contact = {
  company: "BJH Logistics Services Ltd.",
  address: [
    "House of Greener Pastures Building",
    "3rd Floor, Room 6, near Ecobank main branch",
    "Tema Community 1, Tema, Ghana",
  ],
  mapUrl:
    "https://www.google.com/maps/search/?api=1&query=House+of+Greener+Pastures+Building+Tema+Community+1+Ghana",
  hotline: "+233 598 415 519",
  whatsapp: "+233 244 058 592",
  enquiriesEmail: "enquiries@bjhlogistics.com",
  quotesEmail: "quotes@bjhlogistics.com",
  socials: [
    { label: "Facebook", href: "https://web.facebook.com/bjhlogistics" },
    { label: "Instagram", href: "https://www.instagram.com/bjh_logistics/" },
    { label: "X", href: "https://www.twitter.com/bjh_logistics/" },
    {
      label: "LinkedIn",
      href: "https://www.linkedin.com/company/bjhlogistics/",
    },
    { label: "YouTube", href: "https://www.youtube.com/@bjhlogistics" },
  ],
};

export const telHref = (phone: string) => `tel:${phone.replace(/\s/g, "")}`;
export const whatsappHref = (text?: string) =>
  `https://wa.me/${contact.whatsapp.replace(/\D/g, "")}${
    text ? `?text=${encodeURIComponent(text)}` : ""
  }`;

export type IconName =
  | "ship"
  | "plane"
  | "truck"
  | "customs"
  | "warehouse"
  | "door"
  | "offshore"
  | "shield"
  | "container"
  | "license"
  | "project"
  | "recycle"
  | "car"
  | "globe"
  | "anchor"
  | "boxes"
  | "mining"
  | "oil"
  | "aid"
  | "clock"
  | "chat"
  | "coins";

export type Service = {
  slug: string;
  title: string;
  icon: IconName;
  summary: string;
  image?: string;
};

export const serviceGroups: { title: string; services: Service[] }[] = [
  {
    title: "Freight and shipping",
    services: [
      {
        slug: "sea-freight",
        title: "Sea freight",
        icon: "ship",
        image: "/images/tema-port-editorial.webp",
        summary:
          "FCL and LCL shipping with port coordination, documentation support and delivery planning.",
      },
      {
        slug: "air-freight",
        title: "Air freight",
        icon: "plane",
        image: "/images/air-cargo-editorial.webp",
        summary:
          "Priority cargo handling, booking support, customs coordination, pickup planning and time-sensitive delivery.",
      },
      {
        slug: "road-transport",
        title: "Road transport",
        icon: "truck",
        image: "/images/inland-logistics-editorial.webp",
        summary:
          "Trucking for pickup, last-mile delivery, distribution and inland handling across Ghana and West Africa.",
      },
      {
        slug: "freight-forwarding",
        title: "Freight forwarding",
        icon: "globe",
        summary:
          "Cargo coordination from Ghana, combined with transport, documentation and storage under one team.",
      },
      {
        slug: "door-to-door",
        title: "Door-to-door shipping",
        icon: "door",
        summary:
          "Integrated pickup, transport, customs and final delivery, handled end to end.",
      },
      {
        slug: "lcl-consolidation",
        title: "LCL consolidation",
        icon: "boxes",
        // placeholder
        summary:
          "Share container space with other shippers and pay only for the volume your cargo uses.",
      },
      {
        slug: "roro-shipping",
        title: "RoRo shipping",
        icon: "car",
        summary:
          "Roll-on/roll-off support for vehicles, machinery and other rolling cargo.",
      },
    ],
  },
  {
    title: "Customs and compliance",
    services: [
      {
        slug: "customs-clearance",
        title: "Customs clearance",
        icon: "customs",
        summary:
          "Document review, pre-clearance, inspection handling and release planning at the port and airport.",
      },
      {
        slug: "import-export-services",
        title: "Import and export services",
        icon: "anchor",
        // placeholder
        summary:
          "Support for importers and exporters from booking through documentation, clearance and delivery.",
      },
      {
        slug: "import-export-license",
        title: "Import/export licence",
        icon: "license",
        summary:
          "Licensing guidance and document readiness so your cargo is cleared without delay.",
      },
      {
        slug: "cargo-insurance",
        title: "Cargo insurance",
        icon: "shield",
        summary:
          "Protection against loss, damage and theft while your cargo is in transit.",
      },
    ],
  },
  {
    title: "Storage and equipment",
    services: [
      {
        slug: "warehousing",
        title: "Warehousing and bonded storage",
        icon: "warehouse",
        summary:
          "Secure storage with bonded options, cargo handling and inventory support.",
      },
      {
        slug: "container-sales",
        title: "Container sales",
        icon: "container",
        summary:
          "20 ft and 40 ft containers for storage, transport or site use.",
      },
    ],
  },
  {
    title: "Marine and project cargo",
    services: [
      {
        slug: "offshore-ship-supply",
        title: "Offshore services and ship supply",
        icon: "offshore",
        summary:
          "Support for offshore operations and vessel needs, including spares and provisions.",
      },
      {
        slug: "ship-agency",
        title: "Ship agency",
        icon: "anchor",
        // placeholder
        summary:
          "Port call coordination and local representation for vessels calling at Ghana's ports.",
      },
      {
        slug: "project-cargo",
        title: "Project cargo handling",
        icon: "project",
        summary:
          "Oversized and specialist cargo moved with route planning and controlled execution.",
      },
      {
        slug: "scrap-metal-export",
        title: "Scrap metal export",
        icon: "recycle",
        summary:
          "Cargo coordination, documents and movement planning for scrap metal exporters.",
      },
    ],
  },
];

export const allServices = serviceGroups.flatMap((group) => group.services);

export const featuredServices = [
  "sea-freight",
  "air-freight",
  "road-transport",
  "customs-clearance",
  "warehousing",
  "door-to-door",
].map((slug) => allServices.find((service) => service.slug === slug)!);

export const projects: { title: string; icon: IconName; summary: string }[] = [
  {
    title: "Mining logistics",
    icon: "mining",
    summary:
      "Equipment, spares and consumables moved to mine sites, with customs and inland transport planned together.",
  },
  {
    title: "Oil and gas logistics",
    icon: "oil",
    summary:
      "Offshore and onshore supply, ship supply and time-critical parts for the energy sector.",
  },
  {
    title: "Project cargo handling",
    icon: "project",
    summary:
      "Heavy, oversized and high-value cargo with route surveys, special equipment and controlled execution.",
  },
  {
    title: "Humanitarian cargo",
    icon: "aid",
    summary:
      "Relief and development cargo cleared and delivered across West Africa.",
  },
  {
    title: "Automotive and RoRo",
    icon: "car",
    summary:
      "Vehicle imports and fleet shipments for dealerships and companies, from vessel to final delivery.",
  },
  {
    title: "Scrap metal export",
    icon: "recycle",
    summary:
      "Export documents, container loading and shipping for scrap metal exporters.",
  },
];

export const benefits: { title: string; icon: IconName; text: string }[] = [
  {
    title: "Cost-effective solutions",
    icon: "coins",
    text: "Routes, modes and carriers chosen to fit your budget and deadline.",
  },
  {
    title: "Customs expertise",
    icon: "customs",
    text: "Documents checked before your cargo arrives, so it is released without surprises.",
  },
  {
    title: "Global reach",
    icon: "globe",
    text: "Bookings with major ocean and air carriers and a worldwide agent network.",
  },
  {
    title: "Timely deliveries",
    icon: "clock",
    text: "Every step planned and followed up until the cargo is delivered.",
  },
];

export const processSteps = [
  {
    title: "Consultation",
    text: "We learn what you are shipping, where it is going and when it must arrive.",
  },
  {
    title: "Planning",
    text: "We choose the route, mode and carrier and prepare the documents.",
  },
  {
    title: "Execution",
    text: "We book, collect, clear and move your cargo.",
  },
  {
    title: "Monitoring",
    text: "We follow the shipment and keep you updated at every stage.",
  },
  {
    title: "Delivery and follow-through",
    text: "We deliver, confirm and close out the paperwork.",
  },
];

export const differentiators = [
  {
    title: "Practical experience",
    text: `Working from Tema since ${FOUNDED}, we know the port, the airport and the clearance process first-hand.`,
  },
  {
    title: "One integrated team",
    text: "Freight, customs, storage and delivery handled together, so nothing falls between providers.",
  },
  {
    title: "Responsive communication",
    text: "A team you can reach by phone, WhatsApp or email, with clear answers and regular updates.",
  },
];

export const carriers = {
  sea: ["Maersk", "MSC", "CMA CGM", "Hapag-Lloyd", "Yang Ming", "NYK Line"],
  air: ["Emirates", "Turkish Cargo", "Lufthansa Cargo", "KLM Cargo"],
};

export const affiliations = [
  "GIFF",
  "FIATA",
  "IATA",
  "AZfreight",
  "Freightnet",
];

export const faqs = [
  {
    question: "What services does BJH Logistics offer?",
    answer:
      "Sea, air and road freight, customs clearance, warehousing and bonded storage, door-to-door shipping, cargo insurance, container sales, import/export licensing, project cargo, offshore and ship supply.",
  },
  {
    question: "Where are you located?",
    answer:
      "Our office is in Tema Community 1, close to Tema Port, Ghana's main seaport. We handle cargo through Tema, Kotoka International Airport and across West Africa.",
  },
  {
    question: "Can you handle oversized or complex cargo?",
    answer:
      "Yes. We plan routes, equipment and permits for project cargo, heavy machinery, vehicles and other specialist shipments.",
  },
  {
    question: "What do you need to give me a quote?",
    answer:
      "The origin and destination, a description of the cargo, its weight and dimensions (or container type), when it will be ready, and whether you need customs clearance or delivery.",
  },
];
