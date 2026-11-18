/**
 * pdfkit's built-in fonts write a tab as a single hex digit, which shifts and
 * garbles every character after it. Text pasted from Word carries tabs, so
 * every printable swaps them for spaces before measuring or drawing.
 */
export function readableText(doc: PDFKit.PDFDocument): void {
  const clean = <T>(value: T): T =>
    (typeof value === "string" ? value.replace(/\t/g, " ") : value) as T;
  const text = doc.text.bind(doc);
  const heightOfString = doc.heightOfString.bind(doc);
  const widthOfString = doc.widthOfString.bind(doc);
  doc.text = ((value: unknown, ...rest: unknown[]) =>
    (text as (...args: unknown[]) => PDFKit.PDFDocument)(
      clean(value),
      ...rest,
    )) as typeof doc.text;
  doc.heightOfString = (value, options) =>
    heightOfString(clean(value), options);
  doc.widthOfString = (value, options) => widthOfString(clean(value), options);
}
