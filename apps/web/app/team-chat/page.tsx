import { Suspense } from "react";
import { TeamChat } from "./TeamChat";

export const metadata = { title: "Team chat | BJH Logistics" };

export default function TeamChatPage() {
  // TeamChat reads ?c= (a pop-up's conversation) from the address, which Next
  // requires to sit inside a Suspense boundary.
  return (
    <Suspense>
      <TeamChat />
    </Suspense>
  );
}
