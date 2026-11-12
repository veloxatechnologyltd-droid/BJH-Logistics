"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  dismissStaffNotice,
  listStaffNotices,
  snoozeStaffNotice,
} from "./quotations/quoteRequestApi";
import type { StaffNotice } from "./quotations/quoteRequestApi";
import {
  ETA_SOUND_EVERY_MS,
  linkFor,
  pickPopup,
  playAlertSound,
  unlockAlertSound,
} from "./noticeAlerts";

const checkEveryMs = 60_000;

/**
 * The bell in the top bar: requests and inquiries left waiting, ETAs that have
 * passed, and the reminders this person set. A reminder that comes due pops up
 * on screen; an ETA that has passed pops up and sounds until it is checked.
 */
export function StaffNotices() {
  const [due, setDue] = useState<StaffNotice[]>([]);
  const [open, setOpen] = useState(false);
  const [popup, setPopup] = useState<StaffNotice | null>(null);
  // Reminders already popped up in this visit, so one pop-up is not repeated.
  const shown = useRef(new Set<string>());
  const dialog = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    try {
      const notices = await listStaffNotices();
      setDue(notices.due);
      setPopup((current) => current ?? pickPopup(notices.due, shown.current));
    } catch {
      // The bell is a hint; pages show their own errors.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), checkEveryMs);
    return () => window.clearInterval(timer);
  }, [load]);

  const etaDue = due.some((notice) => notice.kind === "eta_due");

  // Sound the alert now and every few seconds until every ETA notice is checked.
  useEffect(() => {
    const unlock = unlockAlertSound();
    if (!etaDue) return unlock;
    playAlertSound();
    const timer = window.setInterval(playAlertSound, ETA_SOUND_EVERY_MS);
    return () => {
      window.clearInterval(timer);
      unlock();
    };
  }, [etaDue]);

  useEffect(() => {
    if (popup) {
      if (popup.kind === "reminder") shown.current.add(popup.id);
      if (!dialog.current?.open) dialog.current?.showModal();
    } else {
      dialog.current?.close();
    }
  }, [popup]);

  async function act(action: () => Promise<unknown>) {
    try {
      await action();
    } finally {
      setPopup(null);
      await load();
    }
  }

  return (
    <div className="notices">
      <button
        aria-expanded={open}
        aria-label={
          due.length ? `Notifications, ${due.length} new` : "Notifications"
        }
        className="notices-bell"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="22"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
          width="22"
        >
          <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {due.length > 0 && (
          <span className="notices-count" aria-hidden="true">
            {due.length > 99 ? "99+" : due.length}
          </span>
        )}
      </button>
      {open && (
        <div className="notices-panel" role="dialog" aria-label="Notifications">
          {due.length === 0 ? (
            <p className="notices-empty">Nothing needs your attention.</p>
          ) : (
            <ul>
              {due.map((notice) => (
                <li key={notice.id}>
                  <Link href={linkFor(notice)} onClick={() => setOpen(false)}>
                    {notice.title}
                  </Link>
                  {notice.note && <span>{notice.note}</span>}
                  <button
                    onClick={() =>
                      void act(() => dismissStaffNotice(notice.id))
                    }
                    type="button"
                  >
                    Dismiss
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <dialog
        aria-labelledby="reminder-title"
        className="notices-popup"
        onCancel={() => setPopup(null)}
        ref={dialog}
      >
        {popup && (
          <>
            <p className="notices-label">
              {popup.kind === "eta_due" ? "ETA reached" : "Reminder"}
            </p>
            <h2 id="reminder-title">{popup.title}</h2>
            {popup.note && <p>{popup.note}</p>}
            <div className="notices-actions">
              <Link
                className="notices-primary"
                href={linkFor(popup)}
                onClick={() => void act(() => dismissStaffNotice(popup.id))}
              >
                {popup.kind === "eta_due" ? "Open the job" : "Open it now"}
              </Link>
              <button
                onClick={() => void act(() => snoozeStaffNotice(popup.id, 60))}
                type="button"
              >
                Remind me in an hour
              </button>
              <button
                onClick={() => void act(() => dismissStaffNotice(popup.id))}
                type="button"
              >
                {popup.kind === "eta_due" ? "I have checked it" : "Dismiss"}
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
