import { FinanceOverview } from "./FinanceOverview";
import { CustomerFinancialReports } from "./CustomerFinancialReports";

export default function FinancePage() {
  return (
    <>
      <FinanceOverview />
      <CustomerFinancialReports />
    </>
  );
}
