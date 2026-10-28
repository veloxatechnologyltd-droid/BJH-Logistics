// BJH's common charges, from their handwritten list. Inputs that use
// `list={id}` suggest these as staff type and still accept any other text.
export const commonCharges = [
  "Customs Clearance",
  "Air Freight",
  "Sea Freight",
  "Road Transport",
  "Amendment Fee",
  "Documentation Fee",
  "Ghana Standards Authority",
  "Food and Drugs Authority",
  "BJH Service Fee",
  "Storage Charges",
  "Customs Examination",
  "Terminal Handling",
  "Shipping Line Charges",
  "Customs Disinfection Fee",
  "Ex-Works Charges",
  "Energy Commission",
  "Environmental Protection",
];

export function ChargeOptions({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {commonCharges.map((charge) => (
        <option key={charge} value={charge} />
      ))}
    </datalist>
  );
}
