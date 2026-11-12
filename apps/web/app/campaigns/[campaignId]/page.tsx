import { CampaignDetail } from "../CampaignDetail";
import { CampaignGate } from "../CampaignGate";

export const metadata = {
  title: "Campaign | BJH Logistics",
  description: "A campaign's search and the businesses it found.",
};

export default function CampaignPage() {
  return (
    <CampaignGate>
      <CampaignDetail />
    </CampaignGate>
  );
}
