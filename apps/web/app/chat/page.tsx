import { Suspense } from "react";
import { ClientChat } from "./ClientChat";

export const metadata = { title: "Client chat | BJH Logistics" };

export default function ClientChatPage() {
  // ClientChat reads ?company= from the address, which Next requires to sit
  // inside a Suspense boundary.
  return (
    <Suspense>
      <ClientChat />
    </Suspense>
  );
}
