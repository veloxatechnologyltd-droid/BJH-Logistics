import { readFileSync } from "node:fs";
import { join } from "node:path";

/** BJH's logo (400 x 155 px); the PNG sits next to this file and nest-cli copies it into the build. */
let logo: Buffer | null | undefined;
function loadLogo(): Buffer | null {
  if (logo === undefined) {
    try {
      logo = readFileSync(join(__dirname, "bjh-logo.png"));
    } catch {
      logo = null;
    }
  }
  return logo;
}

/**
 * Draws the logo with its top-left corner at (x, y) and returns the height it
 * took, or 0 when the file is missing (the caller then lays out as before).
 * Every printable starts with this, so the letterhead looks the same on all.
 */
export function drawLogo(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  height: number,
): number {
  const image = loadLogo();
  if (!image) return 0;
  doc.image(image, x, y, { height });
  return height;
}
