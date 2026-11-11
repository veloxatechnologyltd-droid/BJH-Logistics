import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import { TEST_SUPER_ADMIN_ID, createTestApplication } from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { POSTGRES_POOL } from "../src/database/postgres-database.service";
import { checkDuplicates } from "../src/leads/duplicate-check";
import { mapPlace } from "../src/leads/business-search";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
const campaign = randomUUID();
const otherCampaign = randomUUID();
const customerId = randomUUID();
const leadId = randomUUID();
const prospectId = randomUUID();

before(async () => {
  await beginTestDatabase();
  application = (await createTestApplication()).application;
  const database = application.get(DatabasePort);
  await database.createCustomer({
    id: customerId,
    companyName: "Known Customer Ltd",
    tradingName: "Known Trading",
    website: "https://www.known-customer.example",
    phone: "024 000 0100",
    companyEmail: "accounts@known-customer.example",
    createdAt: new Date().toISOString(),
    contacts: [
      {
        id: randomUUID(),
        name: "Kofi Contact",
        email: "kofi@contact-domain.example",
        phone: "+233 24 000 0101",
        createdAt: new Date().toISOString(),
      },
    ],
  });
  const pool = application.get(POSTGRES_POOL);
  await pool.query(
    `INSERT INTO app.lead (lead_id, company_name, email, phone, created_by)
     VALUES ($1::uuid, 'Known Lead Ltd', 'sales@known-lead.example', '0240000200', $2::uuid)`,
    [leadId, TEST_SUPER_ADMIN_ID],
  );
  for (const id of [campaign, otherCampaign]) {
    await pool.query(
      `INSERT INTO app.lead_campaign (campaign_id, name, target_service, target_industry, target_location, created_by)
       VALUES ($1::uuid, 'Synthetic', 'Sea freight', 'Retail', 'Accra', $2::uuid)`,
      [id, TEST_SUPER_ADMIN_ID],
    );
  }
  await pool.query(
    `INSERT INTO app.prospect (prospect_id, campaign_id, business_name, website, phones, emails,
                               source, source_id, normalized_name)
     VALUES ($1::uuid, $2::uuid, 'Found Earlier Ltd', 'https://found-earlier.example',
             ARRAY['+233240000300'], ARRAY['hello@found-earlier.example'],
             'google_maps', 'place-earlier', 'found earlier'),
            ($3::uuid, $4::uuid, 'Other Campaign Ltd', NULL, '{}', '{}', 'google_maps',
             'place-other', 'other campaign')`,
    [prospectId, campaign, randomUUID(), otherCampaign],
  );
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("the known businesses are every customer and lead, and this campaign's prospects only", async () => {
  const rows = await application
    .get(DatabasePort)
    .listKnownBusinesses(campaign);
  const byId = new Map(rows.map((known) => [known.id, known]));

  const customer = byId.get(customerId);
  assert.equal(customer?.kind, "customer");
  assert.deepEqual(customer?.names.sort(), [
    "Known Customer Ltd",
    "Known Trading",
  ]);
  assert.deepEqual(customer?.websites, ["https://www.known-customer.example"]);
  assert.deepEqual(customer?.emails.sort(), [
    "accounts@known-customer.example",
    "kofi@contact-domain.example",
  ]);
  assert.deepEqual(customer?.phones.sort(), [
    "+233 24 000 0101",
    "024 000 0100",
  ]);

  const lead = byId.get(leadId);
  assert.equal(lead?.kind, "lead");
  assert.deepEqual(lead?.emails, ["sales@known-lead.example"]);

  const prospect = byId.get(prospectId);
  assert.equal(prospect?.kind, "prospect");
  assert.equal(prospect?.sourceId, "place-earlier");
  assert.deepEqual(prospect?.phones, ["+233240000300"]);

  assert.ok(
    !rows.some((known) => known.label === "Other Campaign Ltd"),
    "another campaign's prospects are not compared",
  );
});

test("loaded records drive the check against customers, contacts, leads and prospects", async () => {
  const rows = await application
    .get(DatabasePort)
    .listKnownBusinesses(campaign);
  const place = (title: string, extra: Record<string, unknown>) => ({
    id: randomUUID(),
    business: mapPlace(
      { title, placeId: `p-${title}`, ...extra },
      "google_maps",
    )!,
  });
  const byWebsite = place("Brand New Name", {
    website: "known-customer.example",
  });
  const byContactPhone = place("Phone Match Co", {
    phoneUnformatted: "+233240000101",
  });
  const byLeadEmail = place("Lead Domain Co", {
    website: "https://known-lead.example",
  });
  const byProspect = place("Earlier Again", { phoneUnformatted: "0240000300" });
  const sameName = place("Known Trading Limited", {});
  const fresh = place("Completely Fresh Ltd", {
    website: "https://fresh.example",
  });

  const verdicts = checkDuplicates(
    [byWebsite, byContactPhone, byLeadEmail, byProspect, sameName, fresh],
    rows,
  );
  const flagged = (item: { id: string }) => {
    const verdict = verdicts.get(item.id);
    return verdict?.outcome === "flagged"
      ? `${verdict.kind}:${verdict.strength}`
      : verdict?.outcome;
  };
  assert.equal(flagged(byWebsite), "customer:strong");
  assert.equal(flagged(byContactPhone), "customer:strong");
  assert.equal(flagged(byLeadEmail), "lead:strong");
  assert.equal(flagged(byProspect), "prospect:strong");
  assert.equal(flagged(sameName), "customer:name");
  assert.equal(flagged(fresh), "unique");
});
