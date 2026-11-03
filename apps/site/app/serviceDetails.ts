// Copy for the dedicated /services/[slug] pages.
//
// Written only from BJH's own published service descriptions in content.ts,
// plus plain definitions of industry terms (FCL, LCL, RoRo, bonded storage).
// No prices, transit times, lanes or credentials are stated that BJH has not
// published. Services without an entry here keep their card on /services
// until BJH supplies enough real detail for a page worth indexing.

export type ServiceDetail = {
  /** Page part of the <title>; the layout adds " | BJH Logistics". Max 44 chars. */
  seoTitle: string;
  h1: string;
  /** Meta description. 70 to 155 chars. */
  description: string;
  intro: string;
  includes: string[];
  /** Page-specific questions; the page adds the shared "what do you need to quote" one. */
  faqs: { question: string; answer: string }[];
};

export const serviceDetails: Record<string, ServiceDetail> = {
  "sea-freight": {
    seoTitle: "Sea Freight to and from Ghana",
    h1: "Sea freight services in Ghana",
    description:
      "FCL and LCL sea freight into and out of Ghana through Tema Port: booking, port support, documents and delivery planning from BJH Logistics.",
    intro:
      "BJH Logistics coordinates sea freight for cargo moving into and out of Ghana, from our office in Tema, next to Ghana's principal seaport. We handle full container load (FCL) and less than container load (LCL) cargo, including 20ft and 40ft containers.",
    includes: [
      "Booking and port support for FCL and LCL cargo",
      "Documentation and customs aligned with the booking",
      "Delivery planning from the port to your destination",
      "20ft and 40ft container movements",
    ],
    faqs: [
      {
        question: "What is the difference between FCL and LCL sea freight?",
        answer:
          "FCL (full container load) means your cargo fills a container on its own. LCL (less than container load) means a smaller consignment shares a container with other cargo and is separated on arrival.",
      },
      {
        question: "Can you move 20ft and 40ft containers?",
        answer:
          "Yes. We coordinate 20ft and 40ft container movements, including road transport from Tema to Accra.",
      },
    ],
  },
  "air-freight": {
    seoTitle: "Air Freight Services in Ghana",
    h1: "Air freight services in Ghana",
    description:
      "Air freight booking, customs coordination, pickup planning and time-sensitive delivery management for priority cargo, from BJH Logistics in Tema, Ghana.",
    intro:
      "When cargo cannot wait for a sea transit, BJH Logistics books and manages it by air. We coordinate the booking, the customs formalities and the pickup, and plan delivery around your deadline.",
    includes: [
      "Air cargo booking",
      "Customs coordination",
      "Pickup planning",
      "Time-sensitive delivery management for priority cargo",
    ],
    faqs: [],
  },
  "road-transport": {
    seoTitle: "Road Transport and Trucking in Ghana",
    h1: "Road transport and trucking from Tema",
    description:
      "Pickup, inland trucking, distribution and last-mile delivery beyond the port or airport, including 20ft and 40ft container transport from Tema to Accra.",
    intro:
      "Cargo does not end at the port gate. BJH Logistics arranges pickup, inland trucking, distribution and last-mile delivery beyond the port or airport, including 20ft and 40ft container transport from Tema to Accra.",
    includes: [
      "Pickup from the port or airport",
      "Inland trucking and distribution",
      "Last-mile delivery",
      "20ft and 40ft container transport from Tema to Accra",
    ],
    faqs: [
      {
        question: "Can you deliver containers from Tema to Accra?",
        answer:
          "Yes. We transport 20ft and 40ft containers from Tema to Accra and can plan the delivery together with customs clearance and storage.",
      },
    ],
  },
  "lcl-consolidation": {
    seoTitle: "LCL Consolidation Services in Ghana",
    h1: "LCL consolidation for Ghana",
    description:
      "Shared container capacity for smaller consignments, with consolidation handovers, arrival separation and Ghana release planned together by BJH Logistics.",
    intro:
      "Not every shipment fills a container. LCL (less than container load) consolidation lets smaller consignments share container capacity. BJH Logistics plans the consolidation handover, the separation of cargo on arrival and its release in Ghana together.",
    includes: [
      "Shared container capacity for smaller consignments",
      "Consolidation handovers",
      "Separation of each consignment on arrival",
      "Release planning in Ghana",
    ],
    faqs: [
      {
        question: "What is LCL shipping?",
        answer:
          "LCL means less than container load: a consignment too small to fill a container shares one with other cargo, and each consignment is separated on arrival.",
      },
    ],
  },
  "freight-forwarding": {
    seoTitle: "Freight Forwarding Company in Tema, Ghana",
    h1: "Freight forwarding in Tema, Ghana",
    description:
      "Multi-mode freight forwarding from Tema, Ghana: sea, air and road planned around your cargo and timing, with documents and customs aligned. Get a quote.",
    intro:
      "BJH Logistics Services Ltd is a freight forwarder based in Tema, Ghana, operating since 2006. We plan multi-mode movements around the transit mode, cargo profile and timing, align documents and customs, and keep you updated from booking to handover.",
    includes: [
      "Multi-mode planning across sea, air and road",
      "Documents and customs aligned with the shipment",
      "Updates from booking to handover",
      "One commercial contact for every stage",
    ],
    faqs: [
      {
        question: "What does a freight forwarder do?",
        answer:
          "A freight forwarder arranges the movement of cargo on your behalf: booking transport, preparing documents, coordinating customs clearance and planning delivery. BJH Logistics does this for importers and exporters from Tema, Ghana.",
      },
    ],
  },
  "door-to-door": {
    seoTitle: "Door-to-Door Shipping in Ghana",
    h1: "Door-to-door shipping",
    description:
      "Pickup, main transport, customs clearance, storage where needed and final delivery in one connected plan from BJH Logistics, Tema, Ghana.",
    intro:
      "With door-to-door shipping you deal with one team from pickup to final delivery. BJH Logistics connects the pickup, main transport, customs clearance, storage where needed and delivery in one plan.",
    includes: [
      "Pickup at origin",
      "Main transport by sea, air or road",
      "Customs clearance",
      "Storage where needed",
      "Final delivery",
    ],
    faqs: [
      {
        question: "What does door-to-door shipping include?",
        answer:
          "Pickup, main transport, customs clearance, storage where needed and final delivery, planned as one connected movement. Customs duty, shipping line and port terminal charges are charged at cost in your quotation.",
      },
    ],
  },
  "customs-clearance": {
    seoTitle: "Customs Clearance at Tema Port",
    h1: "Customs clearance at Tema Port",
    description:
      "Customs clearance at Tema Port: entry, examination and release. Non-hazardous containerised cargo takes 3–5 business days once documents are ready.",
    intro:
      "BJH Logistics handles customs clearance at Tema Port, Ghana's principal seaport, from document review and entry preparation through examination and release, for vehicles, general cargo and containerised cargo.",
    includes: [
      "Document review",
      "Entry preparation",
      "Examination handling",
      "Release coordination for vehicles, general cargo and containerised cargo",
    ],
    // The clearance time, documents and duty answers are added from the
    // shared site FAQs by the page, so the figures stay in one place.
    faqs: [],
  },
  warehousing: {
    seoTitle: "Warehousing and Bonded Storage in Tema",
    h1: "Warehousing and bonded storage in Tema",
    description:
      "Secure storage, bonded options, cargo handling, staging and inventory support in Tema, Ghana, for goods that cannot move straight to their destination.",
    intro:
      "When goods cannot go straight to their destination, BJH Logistics arranges secure storage, including bonded options, with cargo handling, controlled staging and inventory support.",
    includes: [
      "Secure storage",
      "Bonded storage options",
      "Cargo handling",
      "Controlled staging",
      "Inventory support",
    ],
    faqs: [
      {
        question: "What is bonded storage?",
        answer:
          "Bonded storage holds imported goods under customs control before duty is paid, for example while documents or onward movement are arranged. Ask us whether a bonded option fits your cargo.",
      },
    ],
  },
  "project-cargo": {
    seoTitle: "Project Cargo Handling in Ghana",
    h1: "Project cargo handling",
    description:
      "Oversized and specialist cargo moved with route awareness, staging and controlled execution, for mining, oil and gas, humanitarian and automotive projects.",
    intro:
      "Some cargo needs more than a standard booking. BJH Logistics moves oversized, specialist and demanding cargo with route awareness, staging and controlled execution, and supports sectors including mining, oil and gas, humanitarian programmes and automotive.",
    includes: [
      "Route awareness for oversized and specialist cargo",
      "Staging",
      "Controlled execution",
      "Combined with customs, transport, storage and documentation support",
    ],
    faqs: [
      {
        question: "What is project cargo?",
        answer:
          "Project cargo is oversized, heavy or specialist cargo, often for a construction, mining, energy or aid project, that needs bespoke planning rather than a standard container booking.",
      },
    ],
  },
  "ship-agency": {
    seoTitle: "Ship Agency Services in Ghana",
    h1: "Ship agency in Ghana",
    description:
      "Port-call support for vessels calling at Ghanaian ports: port formalities, crew husbandry, local vessel assistance and communication with port authorities.",
    intro:
      "BJH Logistics supports vessels calling at Ghanaian ports with port formalities, crew husbandry, local vessel assistance and communication with port authorities.",
    includes: [
      "Port formalities",
      "Crew husbandry",
      "Local vessel assistance",
      "Communication with port authorities",
    ],
    faqs: [
      {
        question: "What does a ship agent do?",
        answer:
          "A ship agent represents the shipowner or operator in port, handling formalities, supplies and communication with port authorities during a vessel's call. BJH Logistics provides this support for vessels calling at Ghanaian ports.",
      },
    ],
  },
  "roro-shipping": {
    seoTitle: "RoRo Vehicle Shipping in Ghana",
    h1: "RoRo shipping for vehicles and automotive cargo",
    description:
      "Roll-on roll-off support for vehicles and automotive cargo, with route, timing, handling and documents coordinated by BJH Logistics in Tema, Ghana.",
    intro:
      "RoRo (roll-on roll-off) shipping moves vehicles that are driven on and off the vessel. BJH Logistics coordinates the route, timing, handling and documents for vehicles and automotive cargo, including dealerships, fleet imports and rolling cargo programmes.",
    includes: [
      "Route and timing coordination",
      "Handling of vehicles and automotive cargo",
      "Documents coordinated with the shipment",
      "Customs clearance for vehicles",
    ],
    faqs: [
      {
        question: "What is RoRo shipping?",
        answer:
          "Roll-on roll-off shipping uses a vessel with ramps, so wheeled cargo such as cars, trucks and machinery is driven on and off instead of being lifted or packed into a container.",
      },
    ],
  },
};

/** Where a service's own page lives: its detail page, else its card on /services. */
export const serviceHref = (slug: string) =>
  Object.hasOwn(serviceDetails, slug)
    ? `/services/${slug}`
    : `/services#${slug}`;
