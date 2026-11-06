import { whatsappHref } from "./content";
import { Icon } from "./Icon";

export function WhatsAppButton() {
  return (
    <a
      href={whatsappHref(
        "Hello BJH Logistics, I would like to make an enquiry.",
      )}
      className="whatsapp-float"
      target="_blank"
      rel="noopener noreferrer"
    >
      <Icon name="whatsapp" size={22} /> Chat with us
    </a>
  );
}
