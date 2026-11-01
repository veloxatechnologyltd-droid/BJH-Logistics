import { KnowledgeBase } from "./KnowledgeBase";

export const metadata = {
  title: "Knowledge base | BJH Logistics",
  description: "What the assistant may tell people who send inquiries.",
};

export default function KnowledgePage() {
  return <KnowledgeBase />;
}
