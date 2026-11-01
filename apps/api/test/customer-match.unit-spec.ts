import assert from "node:assert/strict";
import { test } from "node:test";
import {
  businessDomain,
  findPossibleMatches,
  normalizeCompanyName,
  similarCompanyNames,
} from "../src/intake/customer-match";

const customer = (
  id: string,
  companyName: string,
  emails: string[] = [],
  extra: { tradingName?: string; companyEmail?: string } = {},
) => ({
  id,
  companyName,
  ...extra,
  contacts: emails.map((email) => ({ email })),
});

test("company names are compared without legal endings, punctuation, case or accents", () => {
  assert.equal(
    normalizeCompanyName("Veloxa Technology Ltd."),
    "veloxa technology",
  );
  assert.equal(
    normalizeCompanyName("VELOXA  TECHNOLOGY LIMITED"),
    "veloxa technology",
  );
  assert.equal(normalizeCompanyName("Smith & Sons Co."), "smith sons");
  assert.equal(normalizeCompanyName("Société Générale"), "societe generale");
  // A name made only of such words keeps them rather than becoming empty.
  assert.equal(normalizeCompanyName("The Company Ltd"), "the company ltd");
});

test("the same company written differently is recognised", () => {
  const same: Array<[string, string]> = [
    ["Veloxa Tech", "Veloxa Technology Ltd"],
    ["Veloxa Technology", "Veloxa Technologies Limited"],
    ["VeloxaTech", "Veloxa Technology"],
    ["Veloxa Tech", "Veloxa Tech Ghana"],
    ["veloxa technology ltd", "Veloxa Technology Limited"],
    ["Velox Tech", "Veloxa Tech"],
    ["Kofi Mensah Enterprise", "Kofi Mensah Enterprises"],
  ];
  for (const [a, b] of same) {
    assert.equal(similarCompanyNames(a, b), true, `${a} / ${b}`);
    assert.equal(similarCompanyNames(b, a), true, `${b} / ${a}`);
  }
});

test("different companies are not run together", () => {
  const different: Array<[string, string]> = [
    ["Veloxa Technology", "Northstar Synthetic"],
    ["Global Logistics", "Global Foods"],
    ["Northstar Trading", "Southstar Trading"],
    ["Acme", "Acme Shipping"],
    ["Ama Mensah", "Yaw Mensah"],
    ["", "Veloxa Technology"],
  ];
  for (const [a, b] of different) {
    assert.equal(similarCompanyNames(a, b), false, `${a} / ${b}`);
  }
});

test("a business email domain identifies a company, a free mailbox does not", () => {
  assert.equal(businessDomain("Ama@VeloxaTech.com"), "veloxatech.com");
  assert.equal(businessDomain("ama@mail.veloxatech.com"), "veloxatech.com");
  assert.equal(businessDomain("ama@veloxa.com.gh"), "veloxa.com.gh");
  assert.equal(businessDomain("ama@accounts.veloxa.com.gh"), "veloxa.com.gh");
  assert.equal(businessDomain("ama@gmail.com"), null);
  assert.equal(businessDomain("ama@Yahoo.com"), null);
  assert.equal(businessDomain("not an email"), null);
});

test("a new name from a known company is offered as a possible match, with the reason", () => {
  const known = [
    customer("c1", "Veloxa Technology Ltd", ["ama@veloxatech.com"]),
    customer("c2", "Northstar Synthetic Ltd", ["buyer@northstar.test"]),
  ];

  // Same company, written differently, from a different mailbox.
  assert.deepEqual(
    findPossibleMatches(
      { companyName: "Veloxa Tech", email: "kofi@gmail.com" },
      known,
    ),
    [
      {
        id: "c1",
        companyName: "Veloxa Technology Ltd",
        reasons: ["similar name"],
      },
    ],
  );

  // A colleague at the same business domain, with an unrelated name.
  assert.deepEqual(
    findPossibleMatches(
      { companyName: "Kofi Mensah", email: "kofi@veloxatech.com" },
      known,
    ),
    [
      {
        id: "c1",
        companyName: "Veloxa Technology Ltd",
        reasons: ["same email domain"],
      },
    ],
  );

  // Both signals at once come first.
  const both = findPossibleMatches(
    { companyName: "Veloxa Tech", email: "kofi@veloxatech.com" },
    [customer("c3", "Veloxa Tech Group", ["x@other.test"]), ...known],
  );
  assert.deepEqual(
    both.map((match) => [match.id, match.reasons]),
    [
      ["c1", ["similar name", "same email domain"]],
      ["c3", ["similar name"]],
    ],
  );
});

test("a trading name and the company's own email address count too", () => {
  const known = [
    customer("c1", "VT Holdings Ltd", [], {
      tradingName: "Veloxa Technology",
      companyEmail: "info@veloxatech.com",
    }),
  ];
  assert.equal(
    findPossibleMatches(
      { companyName: "Veloxa Tech", email: "a@gmail.com" },
      known,
    ).length,
    1,
  );
  assert.equal(
    findPossibleMatches(
      { companyName: "Someone", email: "b@veloxatech.com" },
      known,
    ).length,
    1,
  );
});

test("nothing is offered for a genuinely new sender, and a long list is cut", () => {
  const known = [
    customer("c1", "Veloxa Technology Ltd", ["ama@veloxatech.com"]),
  ];
  assert.deepEqual(
    findPossibleMatches(
      { companyName: "Brand New Traders", email: "new@brandnew.test" },
      known,
    ),
    [],
  );
  assert.deepEqual(
    findPossibleMatches(
      { companyName: "Brand New Traders", email: "new@gmail.com" },
      [],
    ),
    [],
  );
  const many = Array.from({ length: 8 }, (_, index) =>
    customer(`c${index}`, `Veloxa Tech ${index}`, [`p@v${index}.test`]),
  );
  assert.equal(
    findPossibleMatches(
      { companyName: "Veloxa Tech", email: "a@gmail.com" },
      many,
    ).length,
    3,
  );
});
