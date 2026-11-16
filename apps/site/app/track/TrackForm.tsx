"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon } from "../Icon";

export function TrackForm({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);

  function submit(event: FormEvent) {
    event.preventDefault();
    const typed = value.trim();
    if (typed) router.push(`/track/${encodeURIComponent(typed)}`);
  }

  return (
    <form className="quote-form track-form" onSubmit={submit}>
      <label>
        Tracking number
        <input
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          inputMode="text"
          maxLength={40}
          onChange={(event) => setValue(event.target.value)}
          placeholder="BJH-XXXX-XXXX"
          required
          spellCheck={false}
          value={value}
        />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">
          Track shipment <Icon name="arrow" size={18} />
        </button>
      </div>
      <p className="form-note">
        Your tracking number was sent to you by email or SMS when your shipment
        was registered.
      </p>
    </form>
  );
}
