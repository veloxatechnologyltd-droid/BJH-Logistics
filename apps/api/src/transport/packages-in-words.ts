const ONES = [
  "ZERO",
  "ONE",
  "TWO",
  "THREE",
  "FOUR",
  "FIVE",
  "SIX",
  "SEVEN",
  "EIGHT",
  "NINE",
  "TEN",
  "ELEVEN",
  "TWELVE",
  "THIRTEEN",
  "FOURTEEN",
  "FIFTEEN",
  "SIXTEEN",
  "SEVENTEEN",
  "EIGHTEEN",
  "NINETEEN",
];
const TENS = [
  "",
  "",
  "TWENTY",
  "THIRTY",
  "FORTY",
  "FIFTY",
  "SIXTY",
  "SEVENTY",
  "EIGHTY",
  "NINETY",
];

function below1000(value: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} HUNDRED`);
  if (rest > 0) {
    if (hundreds > 0) parts.push("AND");
    parts.push(
      rest < 20
        ? ONES[rest]
        : [TENS[Math.floor(rest / 10)], rest % 10 ? ONES[rest % 10] : ""]
            .filter(Boolean)
            .join("-"),
    );
  }
  return parts.join(" ");
}

/**
 * A package count the way a bill of lading writes it: "TEN (10) PACKAGES".
 * Null when the count is not a whole number from 1 to 999,999.
 */
export function packagesInWords(count: number): string | null {
  if (!Number.isInteger(count) || count < 1 || count > 999_999) return null;
  const thousands = Math.floor(count / 1000);
  const rest = count % 1000;
  const words = [
    thousands > 0 ? `${below1000(thousands)} THOUSAND` : "",
    rest > 0
      ? (thousands > 0 && rest < 100 ? "AND " : "") + below1000(rest)
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `${words} (${count.toLocaleString("en-US")}) ${count === 1 ? "PACKAGE" : "PACKAGES"}`;
}
