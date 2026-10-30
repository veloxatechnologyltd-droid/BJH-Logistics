"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const scenes = [
  {
    src: "/images/tema-port-editorial.webp",
    alt: "Illustrative view of a container vessel and port operations",
    label: "01 / SEA FREIGHT",
    title: "From port to possibility.",
  },
  {
    src: "/images/air-cargo-editorial.webp",
    alt: "Illustrative air cargo operations",
    label: "02 / AIR FREIGHT",
    title: "When every hour matters.",
  },
  {
    src: "/images/inland-logistics-editorial.webp",
    alt: "Illustrative inland cargo transport",
    label: "03 / INLAND DELIVERY",
    title: "The journey continues inland.",
  },
];

export function HeroShowcase() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % scenes.length);
    }, 5500);
    return () => window.clearInterval(timer);
  }, [paused]);

  return (
    <div
      className="hero-showcase"
      aria-label="Freight services showcase"
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setPaused(false);
      }}
    >
      {scenes.map((scene, index) => (
        <div
          className={`showcase-slide${active === index ? " active" : ""}`}
          key={scene.src}
          aria-hidden={active !== index}
        >
          <Image
            src={scene.src}
            alt={active === index ? scene.alt : ""}
            fill
            sizes="100vw"
            priority={index === 0}
          />
        </div>
      ))}
      <div className="showcase-bottom">
        <div className="showcase-caption" aria-live="polite">
          <span>{scenes[active].label}</span>
          <strong>{scenes[active].title}</strong>
        </div>
        <div
          className="showcase-controls"
          aria-label="Choose a freight scene"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {scenes.map((scene, index) => (
            <button
              key={scene.src}
              type="button"
              aria-label={`Show ${scene.label.split(" / ")[1].toLowerCase()}`}
              aria-pressed={active === index}
              onClick={() => setActive(index)}
            >
              <span />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
