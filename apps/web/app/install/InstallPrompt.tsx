"use client";

import { useEffect, useRef, useState } from "react";
import { installHintSnoozed, isAppleTouchDevice } from "./installPrompt";

const snoozedKey = "bjh.install.snoozedAt";

/** Chrome's install event, which TypeScript's DOM types do not include. */
type InstallEvent = Event & { prompt: () => Promise<void> };

const alreadyInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

function snoozedNow(): boolean {
  try {
    return installHintSnoozed(
      window.localStorage.getItem(snoozedKey),
      Date.now(),
    );
  } catch {
    // Storage can be blocked; the banner then shows again next visit.
    return false;
  }
}

/**
 * Asks people on a phone or tablet to add the workspace to the home screen.
 * Chrome, Edge and Samsung Internet offer a real install button; iPhones and
 * iPads have none, so there it points at Share, then Add to Home Screen. It is
 * not shown on a computer, once the app is installed, or for 30 days after
 * "Not now".
 */
export function InstallPrompt() {
  const [mode, setMode] = useState<"hidden" | "install" | "apple">("hidden");
  const offered = useRef<InstallEvent | null>(null);

  useEffect(() => {
    // A computer's browser has its own install button.
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    if (alreadyInstalled() || snoozedNow()) return;

    if (
      isAppleTouchDevice(
        navigator.userAgent,
        navigator.platform,
        navigator.maxTouchPoints,
      )
    ) {
      setMode("apple");
      return;
    }
    const onOffer = (event: Event) => {
      // Keep the browser's own pop-up away; the banner asks instead.
      event.preventDefault();
      offered.current = event as InstallEvent;
      setMode("install");
    };
    const onInstalled = () => setMode("hidden");
    window.addEventListener("beforeinstallprompt", onOffer);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onOffer);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const notNow = () => {
    try {
      window.localStorage.setItem(snoozedKey, String(Date.now()));
    } catch {
      // Not remembered; it hides for this visit only.
    }
    setMode("hidden");
  };

  const install = async () => {
    const event = offered.current;
    offered.current = null;
    if (!event) return;
    await event.prompt();
    // Installed or declined, the question has been answered.
    notNow();
  };

  if (mode === "hidden") return null;
  return (
    <section className="install-banner" aria-label="Add to home screen">
      <span className="install-banner-mark" aria-hidden="true">
        BJH
      </span>
      <p className="install-banner-text">
        <strong>Add BJH Logistics to your home screen</strong>
        {mode === "install" ? (
          <span>Opens like an app, full screen, one tap away.</span>
        ) : (
          <span>
            Tap{" "}
            <svg
              aria-hidden="true"
              className="install-share-icon"
              fill="none"
              height="16"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="16"
            >
              <path d="M12 3v12M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
            </svg>{" "}
            <b>Share</b>, then <b>Add to Home Screen</b>.
          </span>
        )}
      </p>
      <div className="install-banner-actions">
        {mode === "install" && (
          <button
            className="install-add"
            onClick={() => void install()}
            type="button"
          >
            Add
          </button>
        )}
        <button className="install-later" onClick={notNow} type="button">
          Not now
        </button>
      </div>
    </section>
  );
}
