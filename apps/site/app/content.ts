// Content combines BJH's company profile and the current bjhlogistics.com
// site (October 2026). Where both describe the same thing, the profile's
// wording is used; everything else from the website is kept.

export const FOUNDED = 2006;

export const PLATFORM_URL = (
  process.env.NEXT_PUBLIC_PLATFORM_URL ?? "http://127.0.0.1:3002"
).replace(/\/$/, "");

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://bjhlogistics.com"
).replace(/\/$/, "");

export const contact = {
  company: "BJH Logistics Services Ltd",
  tagline: "Integrated logistics support from Tema, Ghana",
  address: [
    "House of Greener Pastures Building",
    "3rd Floor, Room 6, near Ecobank main branch",
    "Tema Community 1, Tema, Ghana, West Africa",
  ],
  mapUrl:
    "https://www.google.com/maps/search/?api=1&query=House+of+Greener+Pastures+Building+Tema+Community+1+Ghana",
  hotline: "+233 59 841 5519",
  whatsapp: "+233 24 405 8592",
  telephone: "055 680 7983",
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

export const telHref = (phone: string) =>
  `tel:${phone.replace(/\s/g, "").replace(/^0/, "+233")}`;
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

// Grouped as in the profile's "What the company coordinates".
export const serviceGroups: { title: string; services: Service[] }[] = [
  {
    title: "Transport and freight",
    services: [
      {
        slug: "sea-freight",
        title: "Sea freight",
        icon: "ship",
        image: "/images/tema-port-editorial.webp",
        summary:
          "FCL and LCL coordination, port support, documentation and delivery planning for cargo moving into and out of Ghana, including 20ft and 40ft container movements.",
      },
      {
        slug: "air-freight",
        title: "Air freight",
        icon: "plane",
        image: "/images/air-cargo-editorial.webp",
        summary:
          "Booking, customs coordination, pickup planning and time-sensitive delivery management for priority air cargo.",
      },
      {
        slug: "road-transport",
        title: "Road transport",
        icon: "truck",
        image: "/images/inland-logistics-editorial.webp",
        summary:
          "Pickup, inland trucking, distribution and last-mile delivery beyond the port or airport, including 20ft and 40ft container transport from Tema to Accra.",
      },
      {
        slug: "lcl-consolidation",
        title: "LCL consolidation",
        icon: "boxes",
        summary:
          "Shared container capacity for smaller consignments, with consolidation handovers, arrival separation and Ghana release planned together.",
      },
      {
        slug: "freight-forwarding",
        title: "Freight forwarding",
        icon: "globe",
        summary:
          "Multi-mode planning built around transit mode, cargo profile and timing, with documents and customs aligned and updates from booking to handover.",
      },
      {
        slug: "door-to-door",
        title: "Door-to-door shipping",
        icon: "door",
        summary:
          "Pickup, main transport, customs clearance, storage where needed and final delivery in one connected plan.",
      },
    ],
  },
  {
    title: "Clearance and control",
    services: [
      {
        slug: "customs-clearance",
        title: "Customs clearance",
        icon: "customs",
        summary:
          "Document review, entry preparation, examination handling and release coordination for vehicles, general cargo and containerised cargo.",
      },
      {
        slug: "warehousing",
        title: "Warehousing and bonded storage",
        icon: "warehouse",
        summary:
          "Secure storage, bonded options, cargo handling, controlled staging and inventory support when goods cannot move straight to their destination.",
      },
      {
        slug: "import-export-support",
        title: "Import and export support",
        icon: "anchor",
        summary:
          "Guidance on documentation, licences and cargo readiness for cross-border trade.",
      },
    ],
  },
  {
    title: "Specialist support",
    services: [
      {
        slug: "project-cargo",
        title: "Project cargo handling",
        icon: "project",
        summary:
          "Oversized, specialist or demanding cargo moved with route awareness, staging and controlled execution.",
      },
      {
        slug: "offshore-ship-supply",
        title: "Offshore shipping and ship supply",
        icon: "offshore",
        summary:
          "Support for offshore operations, vessel requirements, ship spares, provisions and maritime project coordination.",
      },
      {
        slug: "ship-agency",
        title: "Ship agency",
        icon: "anchor",
        summary:
          "Port-call support for vessels calling at Ghanaian ports: port formalities, crew husbandry, local vessel assistance and communication with port authorities.",
      },
      {
        slug: "roro-shipping",
        title: "RoRo shipping",
        icon: "car",
        summary:
          "Roll-on roll-off support for vehicles and automotive cargo, with route, timing, handling and documents coordinated.",
      },
      {
        slug: "container-sales",
        title: "Container sales",
        icon: "container",
        summary:
          "20ft and 40ft containers for storage, transport support and operational use.",
      },
      {
        slug: "cargo-insurance",
        title: "Cargo insurance",
        icon: "shield",
        summary:
          "Insurance support for cargo that needs protection against loss, damage, theft and related risks during movement.",
      },
      {
        slug: "import-export-licence",
        title: "Import/export licence support",
        icon: "license",
        summary:
          "Guidance on licensing requirements, document readiness and alignment with Ghanaian import-export processes.",
      },
      {
        slug: "scrap-metal-export",
        title: "Scrap metal export logistics",
        icon: "recycle",
        summary:
          "Commercial and operational coordination for scrap metal export movements.",
      },
    ],
  },
];

export const allServices = serviceGroups.flatMap((group) => group.services);

export const specialistServices = serviceGroups[2].services;

export const featuredServices = [
  "sea-freight",
  "air-freight",
  "road-transport",
  "customs-clearance",
  "warehousing",
  "door-to-door",
].map((slug) => allServices.find((service) => service.slug === slug)!);

// The website's project sectors.
export const sectors: { title: string; icon: IconName; summary: string }[] = [
  {
    title: "Mining logistics",
    icon: "mining",
    summary:
      "Heavy equipment, industrial materials and site-linked deliveries for mining operations.",
  },
  {
    title: "Oil and gas logistics",
    icon: "oil",
    summary:
      "Offshore cargo, vessel-linked support and the operational requirements of the energy sector.",
  },
  {
    title: "Humanitarian cargo",
    icon: "aid",
    summary: "Aid-linked and programme cargo that needs controlled handovers.",
  },
  {
    title: "Automotive and RoRo",
    icon: "car",
    summary: "Dealerships, fleet imports and rolling cargo programmes.",
  },
];

// The profile's "Customers supported".
export const customers: { title: string; icon: IconName; summary: string }[] = [
  {
    title: "Importers",
    icon: "anchor",
    summary:
      "Cargo moving into Ghana by sea, air or road, cleared through customs and delivered.",
  },
  {
    title: "Exporters",
    icon: "globe",
    summary:
      "Bookings, documents and cargo readiness for shipments leaving Ghana.",
  },
  {
    title: "Project cargo teams",
    icon: "project",
    summary:
      "Oversized and specialist movements with route awareness, staging and controlled execution.",
  },
  {
    title: "Offshore operators",
    icon: "offshore",
    summary:
      "Vessel requirements, ship spares, provisions and maritime project coordination.",
  },
  {
    title: "Vehicle and RoRo customers",
    icon: "car",
    summary:
      "Vehicles and automotive cargo shipped roll-on roll-off, with documents and delivery handled.",
  },
  {
    title: "Growing businesses",
    icon: "boxes",
    summary:
      "Dependable freight, customs, storage and onward delivery without managing each stage yourself.",
  },
];

export const benefits: { title: string; icon: IconName; text: string }[] = [
  {
    title: "Cost-effective solutions",
    icon: "coins",
    text: "Competitive commercial planning without losing sight of operational quality and timing.",
  },
  {
    title: "Global reach",
    icon: "globe",
    text: "Air, sea and multimodal coordination gives you wider market access and better support.",
  },
  {
    title: "Timely deliveries",
    icon: "clock",
    text: "Reliable handover planning, storage support, inland movement and milestone visibility.",
  },
  {
    title: "One commercial contact",
    icon: "chat",
    text: "One team coordinates every stage of your shipment, so you don't manage each step separately.",
  },
  {
    title: "Customs and documentation",
    icon: "customs",
    text: "Document review, entry preparation, examination handling and release coordination.",
  },
  {
    title: "Clear cost basis",
    icon: "license",
    text: "Customs duty, shipping line and port terminal charges are passed on at cost in your quotation.",
  },
];

export const processSteps = [
  {
    title: "Consultation",
    text: "We review the cargo type, route, quantities, dimensions, timing and any customs, storage, insurance or delivery needs.",
  },
  {
    title: "Planning",
    text: "We arrange the handling sequence around the freight mode, documents, customs, storage and delivery milestones.",
  },
  {
    title: "Execution",
    text: "We coordinate the cargo movement, handovers, documents and connected services.",
  },
  {
    title: "Monitoring",
    text: "We follow progress, respond to operational issues and keep you informed on timing and release points.",
  },
  {
    title: "Delivery and follow-through",
    text: "We complete final delivery and use your feedback to plan future movements.",
  },
];

export const differentiators = [
  {
    title: `Operating since ${FOUNDED}`,
    text: `Integrated logistics support from Tema, Ghana, since ${FOUNDED}.`,
  },
  {
    title: "Next to Ghana's principal seaport",
    text: "Tema gives direct proximity to the port and strong connections to inland distribution routes.",
  },
  {
    title: "One connected plan",
    text: "Freight, customs, storage, documents and delivery planned around your shipment's route, size, timing and handling needs.",
  },
];

// Carrier lists exactly as the website shows them.
export const carriers = {
  sea: [
    "Maersk",
    "MSC",
    "CMA",
    "Evergreen",
    "Hapag-Lloyd",
    "APL",
    "NYK",
    "PIL",
    "CSAV",
    "Norasia",
    "OOCL",
    "Hanjin",
    "K Line",
    "China Shipping",
    "MCC",
    "UASC",
    "Yang Ming",
  ],
  air: [
    "CX",
    "CZ",
    "CA",
    "JI",
    "LH",
    "UPS",
    "CI",
    "B7",
    "UC",
    "EK",
    "TK",
    "TG",
    "GF",
    "FX",
    "EY",
    "AM",
    "LA",
    "KL",
    "BA",
    "QF",
    "ET",
    "SA",
  ],
};

export const affiliations = [
  { name: "GIFF", detail: "Ghana Institute of Freight Forwarders" },
  { name: "FIATA", detail: "Global freight forwarding network" },
  { name: "IATA", detail: "Air transport industry connection" },
  { name: "AZfreight", detail: "AZfreight.com trade visibility" },
  { name: "Freightnet", detail: "International logistics marketplace" },
];

// The profile's clearance terms for general cargo at Tema Port.
export const clearance = {
  days: "3–5",
  scope:
    "Non-hazardous general cargo in 20ft and 40ft containers at Tema Port.",
  steps: [
    "Bill of entry (BOE) and documentation",
    "Customs examination",
    "Ghana Standards Authority requirements, where applicable",
    "Duty assessment based on HS code and cargo value",
    "Inland delivery arrangements",
  ],
  documents: [
    {
      name: "Commercial invoice",
      purpose: "The declared commercial details and value of the goods.",
    },
    {
      name: "Packing list",
      purpose: "Package contents, quantities and packing arrangement.",
    },
    {
      name: "Bill of lading with telex release",
      purpose: "Shipment identification and cargo release processing.",
    },
  ],
};

export const quoteChecklist = [
  "Cargo type and quantity",
  "Approximate dimensions",
  "Origin and destination",
  "Preferred timing",
  "Any customs, storage, insurance or delivery support needed",
];

export const faqs = [
  {
    question: "What services does BJH Logistics offer?",
    answer:
      "Sea, air and road freight, LCL consolidation, freight forwarding, door-to-door shipping, customs clearance, warehousing and bonded storage, import and export support, project cargo, offshore shipping and ship supply, ship agency, RoRo shipping, container sales, cargo insurance, import/export licence support and scrap metal export logistics.",
  },
  {
    question: "Where are you located?",
    answer:
      "House of Greener Pastures Building, 3rd Floor, Room 6, near Ecobank main branch, Tema Community 1, close to Tema Port, Ghana's principal seaport.",
  },
  {
    question: "How long does customs clearance take at Tema Port?",
    answer:
      "For non-hazardous general cargo in 20ft and 40ft containers, clearance and delivery takes 3–5 business days after the cargo arrives, provided the documents are ready and normal port and customs processes apply.",
  },
  {
    question: "Which documents do I need for clearance?",
    answer:
      "Usually the commercial invoice, packing list and bill of lading with telex release. Ghana Standards Authority requirements may also apply, depending on the cargo.",
  },
  {
    question: "How are customs duty and port charges priced?",
    answer:
      "Customs duty is charged at cost and depends on the HS code and value of the goods. Shipping line and port terminal charges are also charged at cost in your quotation.",
  },
  {
    question: "Can you handle oversized or specialist cargo?",
    answer:
      "Yes. Project cargo handling covers oversized, specialist and demanding movements with route awareness, staging and controlled execution. We also support offshore operations, RoRo vehicle shipments and scrap metal exports.",
  },
  {
    question: "What do you need to give me a quote?",
    answer:
      "The cargo type and quantity, approximate dimensions, origin and destination, preferred timing, and any customs, storage, insurance or delivery support you need.",
  },
];
