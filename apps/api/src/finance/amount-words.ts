const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];
const SCALES = ["", " thousand", " million", " billion", " trillion"];

/** Currencies named in full on an invoice; others are written by code. */
const CURRENCIES: Record<
  string,
  { major: [string, string]; minor: [string, string] }
> = {
  GHS: { major: ["Ghana cedi", "Ghana cedis"], minor: ["pesewa", "pesewas"] },
  USD: { major: ["US dollar", "US dollars"], minor: ["cent", "cents"] },
  EUR: { major: ["euro", "euros"], minor: ["cent", "cents"] },
  GBP: {
    major: ["pound sterling", "pounds sterling"],
    minor: ["penny", "pence"],
  },
  CNY: { major: ["Chinese yuan", "Chinese yuan"], minor: ["fen", "fen"] },
  NGN: { major: ["Nigerian naira", "Nigerian naira"], minor: ["kobo", "kobo"] },
  CAD: {
    major: ["Canadian dollar", "Canadian dollars"],
    minor: ["cent", "cents"],
  },
  AED: { major: ["UAE dirham", "UAE dirhams"], minor: ["fils", "fils"] },
  XOF: { major: ["CFA franc", "CFA francs"], minor: ["centime", "centimes"] },
};

function belowThousand(value: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`);
  if (rest > 0) {
    const tail =
      rest < 20
        ? ONES[rest]
        : TENS[Math.floor(rest / 10)] +
          (rest % 10 ? `-${ONES[rest % 10]}` : "");
    parts.push(hundreds > 0 ? `and ${tail}` : tail);
  }
  return parts.join(" ");
}

/** 12345 -> "twelve thousand three hundred and forty-five". */
export function numberInWords(value: number): string {
  if (value === 0) return ONES[0];
  const groups: string[] = [];
  let rest = Math.floor(value);
  for (let scale = 0; rest > 0; scale += 1) {
    const group = rest % 1000;
    if (group > 0) groups.unshift(belowThousand(group) + SCALES[scale]);
    rest = Math.floor(rest / 1000);
  }
  return groups.join(" ");
}

/** 1000000 + GHS -> "Ten thousand Ghana cedis only." */
export function amountInWords(minor: number, currency: string): string {
  const major = Math.floor(minor / 100);
  const cents = minor % 100;
  const names = CURRENCIES[currency];
  const unit = (
    count: number,
    pair: [string, string] | undefined,
    code: string,
  ) => (pair ? pair[count === 1 ? 0 : 1] : code);
  let text = `${numberInWords(major)} ${unit(major, names?.major, currency)}`;
  if (cents > 0) {
    text += ` and ${numberInWords(cents)} ${names ? unit(cents, names.minor, "") : "hundredths"}`;
  }
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} only.`;
}
