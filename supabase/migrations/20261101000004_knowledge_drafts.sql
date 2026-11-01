-- A starting knowledge base for inquiries, drafted from BJH's own published
-- material (the company profile and bjhlogistics.com, as kept in
-- apps/site/app/content.ts). Each draft is marked for the super admin to check;
-- editing it or pressing "Looks right" clears the mark. Drafts are used to
-- answer inquiries straight away, since BJH already tells customers all of
-- this on its website. No prices, and nothing the sources do not say (office
-- hours, for one, are left for BJH to add).

ALTER TABLE app.knowledge_entry
  -- Drafted for BJH (no person wrote it), and not yet checked by the super admin.
  ADD COLUMN needs_review boolean NOT NULL DEFAULT false,
  ALTER COLUMN updated_by DROP NOT NULL,
  ADD CONSTRAINT knowledge_entry_author_check
    CHECK (updated_by IS NOT NULL OR needs_review);

INSERT INTO app.knowledge_entry (title, answer, needs_review, updated_by) VALUES
(
  'Services we offer',
  'BJH Logistics Services Ltd offers sea freight (FCL and LCL, 20ft and 40ft containers), air freight, road transport and inland delivery, LCL consolidation, freight forwarding, door-to-door shipping, customs clearance, warehousing and bonded storage, import and export support, project cargo handling, offshore shipping and ship supply, ship agency, RoRo shipping, container sales, cargo insurance, import/export licence support and scrap metal export logistics. We support importers, exporters, project cargo teams, offshore operators, vehicle and RoRo customers and growing businesses.',
  true, NULL
),
(
  'Where we are and how to reach us',
  'Our office: House of Greener Pastures Building, 3rd Floor, Room 6, near Ecobank main branch, Tema Community 1, Tema, Ghana, close to Tema Port. Hotline: +233 59 841 5519. Other numbers: +233 53 526 8538 and +233 24 405 8592 (also WhatsApp). Email: enquiries@bjhlogistics.com or info@bjhlogistics.com for questions, quotes@bjhlogistics.com or sales@bjhlogistics.com for quotations. Website: bjhlogistics.com.',
  true, NULL
),
(
  'About BJH Logistics',
  'BJH Logistics Services Ltd has provided integrated logistics support from Tema, Ghana, since 2006. Being next to Tema Port, Ghana''s principal seaport, gives us direct access to the port and to inland distribution routes. One team coordinates freight, customs, storage, documents and delivery around each shipment. We are members of or connected to GIFF (Ghana Institute of Freight Forwarders), FIATA and IATA, and listed on AZfreight and Freightnet.',
  true, NULL
),
(
  'How long customs clearance takes at Tema Port',
  'For non-hazardous general cargo in 20ft and 40ft containers at Tema Port, clearance and delivery usually take 3 to 5 business days after the cargo arrives, provided the documents are ready and normal port and customs processes apply. For other cargo we confirm the timing for each shipment.',
  true, NULL
),
(
  'Documents needed for a sea import clearance',
  'Usually: the commercial invoice (the declared details and value of the goods), the packing list (contents, quantities and packing), and the bill of lading with telex release. Ghana Standards Authority requirements may also apply, depending on the cargo. Clearance covers the bill of entry and documentation, customs examination, Ghana Standards Authority requirements where they apply, duty assessment based on the HS code and value of the cargo, and inland delivery arrangements.',
  true, NULL
),
(
  'How an import clearance works',
  'When we receive your documents, we open a file and give it a file number. We track the shipment and update you on its arrival. We lodge the documents with customs, which assesses the duty, then send you a bill for the duty and the other charges. Once you have paid, we pay the port, terminal and shipping line charges, arrange the release from the shipping line, and book the terminal and the customs inspection. After customs releases the container, we truck it to your address, where the consignee signs a delivery note confirming the goods arrived in good condition. The empty container is then returned to the terminal and the file is closed. Air imports follow the same steps at the airport.',
  true, NULL
),
(
  'How an export works',
  'We prepare the costs and send you an invoice, agree the loading date and book space on the vessel (or with the airline for air cargo). For sea exports we can deliver the empty container to you and stuff it, then bring it back to the port. We complete the customs process, pay the terminal or airport charges, obtain the customs release and ship the cargo. You then receive the final invoice and waybill showing the goods have left Ghana.',
  true, NULL
),
(
  'How duty and port charges are priced',
  'Customs duty is charged at cost: it depends on the HS code and the value of the goods, as assessed by customs. Shipping line and port terminal charges are also passed on at cost in your quotation. Prices are given in a formal quotation; ask us for one with your shipment details.',
  true, NULL
),
(
  'What we need to prepare a quotation',
  'Please send the cargo type and quantity, approximate dimensions and weight, origin and destination, preferred timing, and any customs, storage, insurance or delivery support you need. Send it to quotes@bjhlogistics.com, through the quote form on bjhlogistics.com, or through your BJH client portal account.',
  true, NULL
),
(
  'Air freight',
  'We handle air imports and exports: booking with the airline, customs coordination, airport and airline charges, pickup planning and time-sensitive delivery for priority cargo. We work with airlines including Emirates, Turkish Airlines, Ethiopian Airlines, Lufthansa, KLM, British Airways, Etihad, Cathay Pacific, South African Airways and Gulf Air, and with UPS and FedEx.',
  true, NULL
),
(
  'Sea freight and shipping lines',
  'We coordinate full-container (FCL) and shared-container (LCL) shipments into and out of Ghana, including 20ft and 40ft containers, with port support, documents and delivery planning. Shipping lines we work with include Maersk, MSC, CMA CGM, Evergreen, Hapag-Lloyd, APL, NYK, PIL, OOCL, K Line and Yang Ming.',
  true, NULL
),
(
  'Road transport and delivery',
  'We provide pickup, inland trucking, distribution and last-mile delivery beyond the port or airport, including 20ft and 40ft container transport from Tema to Accra and elsewhere in Ghana. Each road movement comes with a waybill.',
  true, NULL
),
(
  'Warehousing and bonded storage',
  'We offer secure storage, bonded options, cargo handling, controlled staging and inventory support when goods cannot move straight to their destination. We give you inventory reports, and goods you collect are deducted from your stock.',
  true, NULL
),
(
  'LCL consolidation and door-to-door shipping',
  'LCL consolidation gives smaller consignments shared container space, with the consolidation, separation on arrival and release in Ghana planned together. Door-to-door shipping combines pickup, main transport, customs clearance, storage where needed and final delivery in one plan.',
  true, NULL
),
(
  'Project cargo, offshore and ship agency',
  'We move oversized, specialist and demanding cargo with route planning, staging and controlled execution, for sectors such as mining, oil and gas and humanitarian programmes. We support offshore operations (vessel requirements, ship spares, provisions) and act as ship agents for vessels calling at Ghanaian ports: port formalities, crew husbandry, local vessel assistance and communication with the port authorities.',
  true, NULL
),
(
  'Vehicles and RoRo shipping',
  'We support roll-on roll-off (RoRo) shipping of vehicles and automotive cargo, for dealerships and fleet imports, with the route, timing, handling, documents and customs clearance of vehicles coordinated.',
  true, NULL
),
(
  'Container sales, cargo insurance, licences and scrap metal exports',
  'We sell 20ft and 40ft containers for storage, transport and operational use. We arrange cargo insurance against loss, damage, theft and related risks in transit. We guide customers on import and export licence requirements and document readiness. We also coordinate scrap metal export shipments.',
  true, NULL
),
(
  'Tracking a shipment and updates',
  'Every shipment has a BJH file number. We keep you updated on arrival, release and delivery. Customers with a BJH client portal account can follow their shipment''s progress and see their quotations, documents and invoices there. To ask about a shipment, send the file number, bill of lading, container number or air waybill number.',
  true, NULL
);
