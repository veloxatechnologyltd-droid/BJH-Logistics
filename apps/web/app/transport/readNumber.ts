/**
 * Reads a figure typed on a form the way people write it: "1,250.5",
 * "1 250 kg", "12 pcs". Returns null when the box is empty and NaN when the
 * text is not one number, so the form can refuse it instead of dropping it.
 */
export function readNumber(text: string): number | null {
  const cleaned = text
    .trim()
    .replace(
      /\s*(kgs?|kilograms?|pcs|pieces|packages|pkgs?|cartons?|ctns?)\.?$/i,
      "",
    )
    .replace(/[,\s]/g, "");
  if (cleaned === "") return text.trim() === "" ? null : Number.NaN;
  return /^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}
