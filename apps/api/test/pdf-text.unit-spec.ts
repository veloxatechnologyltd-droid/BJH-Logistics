import assert from "node:assert/strict";
import { test } from "node:test";
import PDFDocument from "pdfkit";
import { readableText } from "../src/assets/pdf-text";

function render(draw: (doc: PDFKit.PDFDocument) => void): Promise<string> {
  const doc = new PDFDocument({ compress: false });
  readableText(doc);
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<string>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks).toString("latin1"))),
  );
  draw(doc);
  doc.end();
  return done;
}

test("a tab pasted from Word is drawn as a space, not garbled", async () => {
  const source = await render((doc) => doc.text("Packing\tlist"));
  const drawn = [...source.matchAll(/<([0-9a-f]+)>/gi)]
    .map((hex) => Buffer.from(hex[1], "hex").toString("latin1"))
    .join("");
  assert.ok(drawn.includes("Packing list"), drawn);
});

test("tabbed text is measured as it is drawn", async () => {
  await render((doc) => {
    assert.equal(
      doc.widthOfString("Packing\tlist"),
      doc.widthOfString("Packing list"),
    );
    assert.equal(
      doc.heightOfString("Packing\tlist", { width: 100 }),
      doc.heightOfString("Packing list", { width: 100 }),
    );
  });
});
