import Link from "next/link";
import { CampaignsList } from "./CampaignsList";
import { SalesFrame } from "../sales/SalesFrame";
import sales from "../sales/sales.module.css";

export const metadata = {
  title: "Campaigns | BJH Logistics",
  description: "Find new businesses to sell to and add the good ones to Leads.",
};

export default function CampaignsPage() {
  return (
    <SalesFrame>
      <div className={sales.panelHead}>
        <p className={sales.hubLead} style={{ margin: 0 }}>
          A campaign says what kind of business to look for and where. It finds
          them, scores how well each fits, and puts them in the lead pool.
        </p>
        <Link className={sales.btnPrimary} href="/campaigns/new">
          New campaign
        </Link>
      </div>

      <CampaignsList />
    </SalesFrame>
  );
}
