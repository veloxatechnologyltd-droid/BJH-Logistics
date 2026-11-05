# Document template blueprint

Status: **structural draft for review**. The local client-provided examples are references for document sections and field groups. This blueprint contains no client-specific values and is not an issued document template or a legal/accounting specification.

## Shared layout

- Use the logo's deep blue (`#0B3FAE`, approximate) as the primary color and light blue (`#5C9FD6`, approximate) as the accent, with white backgrounds.
- BJH identity and contact block; document title and type.
- Unique reference and issue date; draft/issued status where applicable.
- Customer/party details and linked job/shipment references.
- A body appropriate to the document type, followed by totals or handling/acknowledgement details.
- Prepared-by/authorised signature fields where the approved document requires them.

## Quotation

The supplied sea-clearance quotations use a scope/title, quote date and reference, prepared-for customer, shipment/container basis, service description, itemised charge tables, currency, required documents, expected timeline, exclusions/at-cost conditions, terms, and customer acceptance/signature fields. Charge rows need a charging basis such as fixed, per bill, per container, or at cost; do not collapse these into one unqualified total.

## Invoice and supplier bill

The supplied `invoice.pdf` is a **third-party port-services invoice**, not a BJH customer invoice. As a structural reference it contains issuer and customer, invoice/reference dates and numbers, linked vessel/booking/container/shipment details, itemised charges with quantity/unit/rate/amount, tax/levy breakdown, currency and total, amount in words, container details, payment instructions, and tax/e-invoice status.

Keep supplier invoices and BJH-issued customer invoices as distinct document types. Store the source and issuer; do not represent an uploaded supplier invoice as a BJH-issued invoice. Tax/levy names, rates, calculation basis, official invoice numbering, currency conversion and legal/e-invoice status remain subject to D03 approval.

## Bill of lading and air cargo documents

The supplied transport bill and HBL layouts group:

- shipper, consignee, notify party, forwarding agent and contacts;
- master/house reference numbers, booking and carrier/vessel/flight;
- ports/airports, routing, place of receipt and final delivery;
- container/seal or package count, goods description, HS code when known, weight and volume;
- freight prepaid/collect or other carrier terms; and
- issue date/place, original/release status, carrier/agent signature and stamp.

The air manifest is a consolidated shipment summary, with master/house air-waybill references, route/carrier, parties, handling information, per-house package/weight/volume/cargo rows, totals, cargo status, and certification. The sea cargo manifest (BJH's "breakdown" sheet, `EVIDENCES/BJH_Breakdown.pdf`) lists the house bills of lading under one master B/L and container: shipper and consignee, MBL, vessel, container number and total packages, then one row per house B/L (shipper, consignee, BL number, item description, weight) with the total weight. Both manifests keep their rows as a table (JSON in the document's `fields`) and print the total row; the air manifest prints landscape like the Athens sample (`EVIDENCES/BJH_Air_Cargo_Manifest_Athens.pdf`) with its certification text. Carrier-issued B/L/AWB forms remain source documents; the app may record their metadata or produce a manifest, but should not imitate or issue a carrier form without an approved template and authority.

## Proof of delivery

The supplied BJH proof-of-delivery sheets identify the AWB, consignee and goods, package count and weight, delivery date/time, receiver name and telephone, signature, and carrier/customer stamp. Treat this as **cargo receipt/acceptance**, not evidence that money was received.

## Customer payment receipt

The user confirms a conventional receipt with customer details. The receipt photo is not present in the local `EVIDENCES/` folder, so this is a replaceable field outline pending visual comparison:

- BJH name/contact details and receipt title/number/date;
- received-from customer/company details;
- amount in figures and words, currency, and payment date;
- payment method and external reference;
- related invoice and job/shipment reference, where applicable;
- description or allocation of the payment; and
- received-by name/signature and any approved stamp.

This records money received outside the app; it must not imply bank verification or in-app collection. Partial-payment allocation, reversals, receipt numbering and required wording remain subject to D03/client-finance confirmation.

## Customer visibility

Customer access to invoices, waybills, receipts, and all other business records follows explicit company membership: users see all records belonging to their assigned company or companies, and no records belonging to other companies. Do not gate company-owned records behind a per-document publication flag or document-type allowlist. BJH-only administrative records are not customer-company records.
