"use client";

import Image from "next/image";
import Link from "next/link";
import { useId, useState, type CSSProperties } from "react";
import { Icon } from "./Icon";
import type { Service } from "./content";

/** Image and title only; the description opens on demand. */
export function ServiceTile({
  service,
  delay,
}: {
  service: Service;
  delay: number;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    // The open state lives in a data attribute, not className: ScrollEffects
    // adds `in` to this element, and a className change would wipe it out.
    <article
      className="service-tile reveal pop"
      data-open={open}
      style={{ "--d": `${delay}ms` } as CSSProperties}
    >
      {service.image ? (
        <Image
          src={service.image}
          alt={`Illustrative ${service.title.toLowerCase()} scene`}
          width={1200}
          height={650}
          className="service-tile-media"
        />
      ) : (
        <div className="service-tile-media service-tile-icon">
          <Icon name={service.icon} size={56} />
        </div>
      )}
      <div className="service-tile-body">
        <h3>{service.title}</h3>
        <button
          type="button"
          className="tile-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
        >
          Learn more
          <span className="tile-plus" aria-hidden="true" />
        </button>
        <div id={panelId} className="tile-panel" inert={!open}>
          <div>
            <p>{service.summary}</p>
            <Link href={`/services#${service.slug}`} className="card-link">
              Full details <Icon name="arrow" size={16} />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
