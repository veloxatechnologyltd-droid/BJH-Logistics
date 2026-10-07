import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { INestApplication } from "@nestjs/common";
import { createTestApplication, staffFetch } from "./test-application";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;

async function startApplication(): Promise<void> {
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
}

async function createCustomer(input: unknown): Promise<Response> {
  return staffFetch(`${baseUrl}/api/v1/customers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

before(async () => {
  await beginTestDatabase();
  await startApplication();
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("customers can be created, searched, and retrieved with contacts", async () => {
  const response = await createCustomer({
    companyName: "  Northstar Demo Ltd  ",
    contactName: "  Alex Demo  ",
    email: "alex@northstar-demo.test",
  });

  assert.equal(response.status, 201, await response.clone().text());
  const created = (await response.json()) as {
    id: string;
    customerNumber: string;
    companyName: string;
    createdAt: string;
    contacts: Array<{
      id: string;
      name: string;
      email: string;
      createdAt: string;
    }>;
  };
  assert.equal(created.companyName, "Northstar Demo Ltd");
  assert.match(created.customerNumber, /^CUS-\d{4,}$/);
  assert.equal(created.contacts.length, 1);
  assert.equal(created.contacts[0]?.name, "Alex Demo");
  assert.equal(created.contacts[0]?.email, "alex@northstar-demo.test");
  assert.ok(Number.isFinite(Date.parse(created.createdAt)));

  for (const search of [
    "northstar",
    "alex demo",
    "northstar-demo.test",
    created.customerNumber,
  ]) {
    const listResponse = await staffFetch(
      `${baseUrl}/api/v1/customers?search=${encodeURIComponent(search)}`,
    );
    assert.equal(listResponse.status, 200);
    assert.deepEqual(await listResponse.json(), [created]);
  }

  const detailResponse = await staffFetch(
    `${baseUrl}/api/v1/customers/${created.id}`,
  );
  assert.equal(detailResponse.status, 200);
  assert.deepEqual(await detailResponse.json(), created);
});

test("same-name customer submissions remain separate records", async () => {
  const first = await createCustomer({
    companyName: "Repeated Demo Ltd",
    contactName: "First Contact",
    email: "first@example.test",
  });
  const second = await createCustomer({
    companyName: "Repeated Demo Ltd",
    contactName: "Second Contact",
    email: "second@example.test",
  });

  const firstCustomer = (await first.json()) as {
    id: string;
    customerNumber: string;
  };
  const secondCustomer = (await second.json()) as {
    id: string;
    customerNumber: string;
  };
  assert.notEqual(firstCustomer.id, secondCustomer.id);
  assert.notEqual(firstCustomer.customerNumber, secondCustomer.customerNumber);

  const searchResponse = await staffFetch(
    `${baseUrl}/api/v1/customers?search=Repeated%20Demo`,
  );
  const matches = (await searchResponse.json()) as Array<{ id: string }>;
  assert.equal(matches.length, 2);
});

test("customer profiles save company details and editable primary contacts", async () => {
  const response = await createCustomer({
    companyName: "Harborline Export Company",
    tradingName: "Harborline",
    registrationNumber: "REG-2048",
    taxNumber: "TIN-2048",
    companyPhone: "+233 30 200 4000",
    companyEmail: "office@harborline.test",
    website: "https://harborline.test",
    businessAddress: "12 Port Road, Tema, Ghana",
    billingAddress: "P.O. Box 21, Tema, Ghana",
    country: "Ghana",
    contactName: "Avery Client",
    contactRole: "Logistics Manager",
    email: "avery@harborline.test",
    phone: "+233 24 200 4000",
  });
  assert.equal(response.status, 201, await response.clone().text());
  const created = (await response.json()) as {
    id: string;
    tradingName: string | null;
    registrationNumber: string | null;
    taxNumber: string | null;
    phone: string | null;
    companyEmail: string | null;
    website: string | null;
    businessAddress: string | null;
    billingAddress: string | null;
    country: string | null;
    contacts: Array<{
      id: string;
      role: string | null;
      email: string;
      phone: string | null;
      isPrimary: boolean;
    }>;
  };
  assert.equal(created.tradingName, "Harborline");
  assert.equal(created.registrationNumber, "REG-2048");
  assert.equal(created.taxNumber, "TIN-2048");
  assert.equal(created.phone, "+233 30 200 4000");
  assert.equal(created.companyEmail, "office@harborline.test");
  assert.equal(created.website, "https://harborline.test");
  assert.equal(created.businessAddress, "12 Port Road, Tema, Ghana");
  assert.equal(created.billingAddress, "P.O. Box 21, Tema, Ghana");
  assert.equal(created.country, "Ghana");
  assert.equal(created.contacts[0]?.role, "Logistics Manager");
  assert.equal(created.contacts[0]?.phone, "+233 24 200 4000");
  assert.equal(created.contacts[0]?.isPrimary, true);
  for (const search of ["REG-2048", "TIN-2048", "Tema", "Logistics Manager"]) {
    const matches = await staffFetch(
      `${baseUrl}/api/v1/customers?search=${encodeURIComponent(search)}`,
    );
    assert.equal(matches.status, 200);
    assert.equal(
      ((await matches.json()) as Array<{ id: string }>)[0]?.id,
      created.id,
      `search should find the profile by ${search}`,
    );
  }

  const updateResponse = await staffFetch(
    `${baseUrl}/api/v1/customers/${created.id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyName: "Harborline Export Company Ltd",
        tradingName: "Harborline",
        registrationNumber: "REG-2048",
        taxNumber: "TIN-2048",
        phone: "+233 30 200 4000",
        companyEmail: "office@harborline.test",
        website: "https://harborline.test",
        businessAddress: "14 Port Road, Tema, Ghana",
        billingAddress: "P.O. Box 21, Tema, Ghana",
        country: "Ghana",
      }),
    },
  );
  assert.equal(updateResponse.status, 200, await updateResponse.clone().text());
  const updated = (await updateResponse.json()) as typeof created & {
    companyName: string;
    businessAddress: string | null;
  };
  assert.equal(updated.companyName, "Harborline Export Company Ltd");
  assert.equal(updated.businessAddress, "14 Port Road, Tema, Ghana");

  const secondContactResponse = await staffFetch(
    `${baseUrl}/api/v1/customers/${created.id}/contacts`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Morgan Billing",
        role: "Accounts",
        email: "accounts@harborline.test",
        isPrimary: true,
      }),
    },
  );
  assert.equal(
    secondContactResponse.status,
    201,
    await secondContactResponse.clone().text(),
  );
  const secondContact = (await secondContactResponse.json()) as {
    id: string;
    isPrimary: boolean;
  };
  assert.equal(secondContact.isPrimary, true);
  const afterAddingContact = await staffFetch(
    `${baseUrl}/api/v1/customers/${created.id}`,
  );
  const contacts = (
    (await afterAddingContact.json()) as {
      contacts: Array<{ id: string; isPrimary: boolean }>;
    }
  ).contacts;
  assert.equal(
    contacts.find((contact) => contact.id === created.contacts[0]?.id)
      ?.isPrimary,
    false,
  );
  assert.equal(
    contacts.find((contact) => contact.id === secondContact.id)?.isPrimary,
    true,
  );

  const updatedContactResponse = await staffFetch(
    `${baseUrl}/api/v1/customers/${created.id}/contacts/${created.contacts[0]?.id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Avery Updated",
        role: "Operations Director",
        email: "avery.updated@harborline.test",
        phone: "+233 24 300 5000",
        notify: false,
        isPrimary: true,
      }),
    },
  );
  assert.equal(
    updatedContactResponse.status,
    200,
    await updatedContactResponse.clone().text(),
  );
  const updatedContact = (await updatedContactResponse.json()) as {
    name: string;
    role: string | null;
    email: string;
    phone: string | null;
    notify: boolean;
    isPrimary: boolean;
  };
  assert.equal(updatedContact.name, "Avery Updated");
  assert.equal(updatedContact.role, "Operations Director");
  assert.equal(updatedContact.email, "avery.updated@harborline.test");
  assert.equal(updatedContact.phone, "+233 24 300 5000");
  assert.equal(updatedContact.notify, false);
  assert.equal(updatedContact.isPrimary, true);

  const foundById = await staffFetch(
    `${baseUrl}/api/v1/customers/${created.id}`,
  );
  assert.equal(foundById.status, 200);
  const profile = (await foundById.json()) as typeof updated;
  assert.equal(profile.contacts[0]?.email, "avery.updated@harborline.test");
});

test("invalid customers and unknown customer IDs fail safely", async () => {
  const invalidResponse = await createCustomer({
    companyName: "Example Ltd",
    contactName: "Alex Demo",
    email: "invalid-email",
  });
  assert.equal(invalidResponse.status, 400);

  const oversizeSearch = await staffFetch(
    `${baseUrl}/api/v1/customers?search=${"x".repeat(201)}`,
  );
  assert.equal(oversizeSearch.status, 400);

  const missingResponse = await staffFetch(
    `${baseUrl}/api/v1/customers/unknown-customer`,
  );
  assert.equal(missingResponse.status, 404);
});

test("customer companies and contacts persist after an API restart", async () => {
  const response = await createCustomer({
    companyName: "Restart Demo Ltd",
    contactName: "Taylor Demo",
    email: "taylor@example.test",
  });
  const created = (await response.json()) as { id: string };

  await application.close();
  await startApplication();

  const detailResponse = await staffFetch(
    `${baseUrl}/api/v1/customers/${created.id}`,
  );
  assert.equal(detailResponse.status, 200);
  const customer = (await detailResponse.json()) as {
    contacts: Array<{ email: string }>;
  };
  assert.equal(customer.contacts[0]?.email, "taylor@example.test");
});
