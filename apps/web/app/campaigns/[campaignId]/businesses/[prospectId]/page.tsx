import { CampaignGate } from "../../../CampaignGate";
import { ProspectDetails } from "../../../ProspectDetails";

export const metadata = {
  title: "Business | BJH Logistics",
  description: "Everything a campaign's search found about one business.",
};

export default function BusinessPage() {
  return (
    <CampaignGate>
      <ProspectDetails />
    </CampaignGate>
  );
}
