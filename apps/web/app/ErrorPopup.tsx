"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./errorPopup.module.css";

const plainWording: Array<[RegExp, string]> = [
  [
    /cannot be in the future/i,
    "That date or time has not happened yet. Please choose a date and time that is today or earlier.",
  ],
  [
    /failed to fetch|networkerror|load failed|network request failed/i,
    "We could not reach the system. Please check your internet connection and try again.",
  ],
  [
    /internal server error|^5\d\d\b/i,
    "Something went wrong on our side. Please try again in a moment.",
  ],
  [
    /forbidden|unauthori[sz]ed/i,
    "You do not have permission to do this. If you think you should, please ask your administrator.",
  ],
  [
    /must be a uuid|should not be empty|must be (a|an) (string|number|email)|must be longer|must be shorter/i,
    "Some details are missing or not filled in correctly. Please check the form and try again.",
  ],
];

/** Turns a technical message into wording that anyone can act on. */
export function plainMessage(message: string): string {
  return (
    plainWording.find(([pattern]) => pattern.test(message))?.[1] ?? message
  );
}

/**
 * Shows an error in the middle of the screen so nobody has to scroll to find
 * it. Pass the page's error text; the popup opens whenever the text is set and
 * closes when it is cleared or the person presses OK.
 */
export function ErrorPopup({ message }: { message: string }) {
  const [dismissed, setDismissed] = useState("");
  const okRef = useRef<HTMLButtonElement>(null);
  const open = Boolean(message) && dismissed !== message;

  // Clearing the message (a new attempt) lets the same error appear again.
  useEffect(() => {
    if (!message) setDismissed("");
  }, [message]);

  useEffect(() => {
    if (open) okRef.current?.focus();
  }, [open]);

  if (!open) return null;
  const close = () => setDismissed(message);
  return (
    <div
      className={styles.backdrop}
      onClick={close}
      onKeyDown={(event) => event.key === "Escape" && close()}
    >
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-popup-title"
        aria-describedby="error-popup-text"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="error-popup-title">That did not work</h2>
        <p id="error-popup-text">{plainMessage(message)}</p>
        <button type="button" ref={okRef} onClick={close}>
          OK
        </button>
      </div>
    </div>
  );
}
