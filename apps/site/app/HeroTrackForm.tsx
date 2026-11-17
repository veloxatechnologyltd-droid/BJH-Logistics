"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon } from "./Icon";

export function HeroTrackForm() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const typed = value.trim();
    if (typed) router.push(`/track/${encodeURIComponent(typed)}`);
  }

  return (
    <form className="hero-track" onSubmit={submit}>
      <label htmlFor="hero-track-number">Track your shipment</label>
      <div className="hero-track-row">
        <input
          id="hero-track-number"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          maxLength={40}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Tracking number, BJH-XXXX-XXXX"
          required
          spellCheck={false}
          value={value}
        />
        <button type="submit" className="btn btn-primary">
          Track <Icon name="arrow" size={18} />
        </button>
      </div>
    </form>
  );
}
