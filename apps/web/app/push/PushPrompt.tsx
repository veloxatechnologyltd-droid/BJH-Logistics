"use client";

import { useEffect, useState } from "react";
import {
  pushIsOn,
  pushKey,
  pushSupported,
  refreshPush,
  turnOnPush,
} from "./pushClient";
import styles from "./push.module.css";

const snoozedKey = "bjh.push.snoozedAt";
const snoozeDays = 7;

function snoozed(): boolean {
  try {
    const at = Number(window.localStorage.getItem(snoozedKey));
    return at > 0 && Date.now() - at < snoozeDays * 24 * 60 * 60 * 1000;
  } catch {
    // Storage can be blocked; the banner then shows again next visit.
    return false;
  }
}

function snooze() {
  try {
    window.localStorage.setItem(snoozedKey, String(Date.now()));
  } catch {
    // Not remembered; it hides for this visit only.
  }
}

/**
 * Asks staff to get notified about new messages and requests even when BJH is
 * closed (Evans, 2026-11-04). Shown only where it can work: the browser
 * supports it, the server has push keys, this person has not said no, and this
 * browser is not already subscribed. A browser that is subscribed already has
 * the server's copy refreshed instead.
 */
export function PushPrompt() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let current = true;
    void (async () => {
      if (!pushSupported() || Notification.permission === "denied") return;
      if (await pushIsOn()) {
        void refreshPush();
        return;
      }
      if (snoozed()) return;
      if (!(await pushKey().catch(() => null))) return;
      if (current) setShow(true);
    })();
    return () => {
      current = false;
    };
  }, []);

  const notNow = () => {
    snooze();
    setShow(false);
  };

  const turnOn = async () => {
    setBusy(true);
    setProblem("");
    try {
      // Browsers only let a click ask for permission.
      if ((await Notification.requestPermission()) !== "granted") {
        notNow();
        return;
      }
      if ((await turnOnPush()) === "on") setShow(false);
      else setProblem("Notifications are not available right now.");
    } catch {
      setProblem("Notifications could not be turned on. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!show) return null;
  return (
    <section className={styles.banner} aria-label="Notifications">
      <span className={styles.mark} aria-hidden="true">
        BJH
      </span>
      <p className={styles.text}>
        <strong>Get notified about new messages and requests</strong>
        <span>
          {problem ||
            "They arrive on this device even when BJH is closed, and stay until you read them."}
        </span>
      </p>
      <div className={styles.actions}>
        <button
          className={styles.turnOn}
          disabled={busy}
          onClick={() => void turnOn()}
          type="button"
        >
          {busy ? "Turning on…" : "Turn on"}
        </button>
        <button className={styles.later} onClick={notNow} type="button">
          Not now
        </button>
      </div>
    </section>
  );
}
