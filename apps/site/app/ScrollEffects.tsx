"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** Fades `.reveal` elements in and counts up `[data-count]` numbers as they scroll into view. */
export function ScrollEffects() {
  const pathname = usePathname();
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateProgress = () => {
      const scrollable =
        document.documentElement.scrollHeight - window.innerHeight;
      const progress = scrollable > 0 ? window.scrollY / scrollable : 0;
      if (progressRef.current)
        progressRef.current.style.transform = `scaleX(${Math.min(1, Math.max(0, progress))})`;
    };
    updateProgress();
    window.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress);
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    document.documentElement.classList.add("motion");

    const countUp = (element: HTMLElement) => {
      const target = Number(element.dataset.count);
      if (reduced) {
        element.textContent = String(target);
        return;
      }
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min((now - start) / 1400, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        element.textContent = String(Math.round(target * eased));
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const element = entry.target as HTMLElement;
          element.classList.add("in");
          if (element.dataset.count) countUp(element);
          observer.unobserve(element);
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );

    document
      .querySelectorAll<HTMLElement>(".reveal, [data-count]")
      .forEach((element) => observer.observe(element));
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", updateProgress);
      window.removeEventListener("resize", updateProgress);
    };
  }, [pathname]);

  return (
    <div ref={progressRef} className="scroll-progress" aria-hidden="true" />
  );
}
