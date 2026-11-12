"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { listCampaigns } from "../../campaigns/campaignApi";
import type { Campaign } from "../../campaigns/campaignApi";
import {
  getSalesEmail,
  getSalesEmailAttachmentDownload,
  getSalesEmailThread,
  listSalesEmails,
  listSalesEmailFolders,
  previewSalesEmail,
  retrySalesEmail,
  sendSalesEmail,
  syncSalesMailbox,
  unsubscribeSalesEmailSender,
} from "../salesApi";
import type { SalesEmailComposition } from "../salesApi";
import type { SalesEmail } from "../salesApi";
import type { SalesEmailDetail } from "../salesApi";
import styles from "../sales.module.css";

function messageDate(message: SalesEmail) {
  const date = message.receivedAt ?? message.acceptedAt ?? message.createdAt;
  return new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

function SalesEmailComposer({
  onQueued,
  replyTo,
  clearReply,
}: {
  onQueued: () => void;
  replyTo: SalesEmail | null;
  clearReply: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignIds, setCampaignIds] = useState<string[]>([]);
  const [addressText, setAddressText] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<string[] | null>(null);
  const [sendRequestId, setSendRequestId] = useState<string | null>(null);
  const [suppressed, setSuppressed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!replyTo) return;
    setOpen(true);
    setCampaignIds([]);
    setAddressText(replyTo.fromEmail);
    setSubject(
      /^re:/i.test(replyTo.subject)
        ? replyTo.subject
        : `Re: ${replyTo.subject}`,
    );
    setBody("");
    setPreview(null);
    setSendRequestId(null);
  }, [replyTo]);

  useEffect(() => {
    if (!open || campaigns.length > 0) return;
    listCampaigns()
      .then(setCampaigns)
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Campaigns could not be loaded",
        ),
      );
  }, [open, campaigns.length]);

  function composition(): SalesEmailComposition {
    return {
      emails: addressText
        .split(/[\s,;]+/)
        .map((email) => email.trim())
        .filter(Boolean),
      campaignIds,
      subject,
      body,
      ...(replyTo ? { replyToMessageId: replyTo.id } : {}),
    };
  }

  async function makePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await previewSalesEmail(composition());
      setPreview(result.recipients);
      setSendRequestId(crypto.randomUUID());
      setSuppressed(result.suppressed);
    } catch (cause) {
      setPreview(null);
      setSendRequestId(null);
      setError(
        cause instanceof Error ? cause.message : "Recipient preview failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function queueSend() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await sendSalesEmail({
        ...composition(),
        expectedRecipients: preview ?? [],
        sendRequestId: sendRequestId ?? undefined,
      });
      setNotice(
        `${result.queued} individual email${result.queued === 1 ? "" : "s"} queued. ${result.suppressed} suppressed.`,
      );
      setPreview(null);
      setSendRequestId(null);
      onQueued();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The emails could not be queued",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={styles.composePanel}
      aria-labelledby="compose-sales-email"
    >
      <div className={styles.composePanelHeader}>
        <div>
          <h3 id="compose-sales-email">Compose an email</h3>
          {replyTo && <p>Replying to {replyTo.fromEmail}</p>}
          <p>
            Send to individual addresses, campaigns, or both. Each person gets a
            separate message.
          </p>
        </div>
        <button
          className={styles.secondaryButton}
          onClick={() => {
            if (replyTo) {
              clearReply();
              setAddressText("");
              setSubject("");
              setBody("");
              setPreview(null);
              setSendRequestId(null);
              setOpen(false);
            } else {
              setOpen((value) => !value);
            }
          }}
          type="button"
        >
          {open ? "Close composer" : "New email"}
        </button>
      </div>
      {notice && (
        <p className={styles.mailNotice} role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className={styles.mailError} role="alert">
          {error}
        </p>
      )}
      {open && (
        <form className={styles.composeForm} onSubmit={makePreview}>
          <label htmlFor="sales-email-addresses">
            Individual email addresses
          </label>
          <textarea
            id="sales-email-addresses"
            onChange={(event) => {
              setAddressText(event.target.value);
              setPreview(null);
              setSendRequestId(null);
            }}
            placeholder="name@example.com, another@example.com"
            rows={2}
            value={addressText}
          />
          {!replyTo && (
            <fieldset className={styles.campaignChoice}>
              <legend>Campaign recipients</legend>
              {campaigns.filter((campaign) => campaign.status === "active")
                .length === 0 ? (
                <p>No active campaigns.</p>
              ) : (
                campaigns
                  .filter((campaign) => campaign.status === "active")
                  .map((campaign) => (
                    <label key={campaign.id}>
                      <input
                        checked={campaignIds.includes(campaign.id)}
                        onChange={(event) => {
                          setCampaignIds((current) =>
                            event.target.checked
                              ? [...current, campaign.id]
                              : current.filter((id) => id !== campaign.id),
                          );
                          setPreview(null);
                          setSendRequestId(null);
                        }}
                        type="checkbox"
                      />
                      <span>
                        {campaign.name}{" "}
                        <small>({campaign.prospectCount} businesses)</small>
                      </span>
                    </label>
                  ))
              )}
            </fieldset>
          )}
          <label htmlFor="sales-email-subject">Subject</label>
          <input
            id="sales-email-subject"
            maxLength={200}
            onChange={(event) => {
              setSubject(event.target.value);
              setPreview(null);
              setSendRequestId(null);
            }}
            required
            value={subject}
          />
          <label htmlFor="sales-email-body">Message</label>
          <textarea
            id="sales-email-body"
            maxLength={20000}
            onChange={(event) => {
              setBody(event.target.value);
              setPreview(null);
              setSendRequestId(null);
            }}
            required
            rows={8}
            value={body}
          />
          <button
            className={styles.secondaryButton}
            disabled={busy}
            type="submit"
          >
            {busy ? "Checking…" : "Preview recipients"}
          </button>
          {preview && (
            <div className={styles.recipientPreview}>
              <h4>{preview.length} recipients</h4>
              {suppressed.length > 0 && (
                <p>
                  {suppressed.length} opted-out or suppressed addresses will be
                  skipped.
                </p>
              )}
              <ul>
                {preview.map((email) => (
                  <li key={email}>{email}</li>
                ))}
              </ul>
              <button
                className={styles.primaryButton}
                disabled={busy || preview.length === 0 || !sendRequestId}
                onClick={() => void queueSend()}
                type="button"
              >
                {busy
                  ? "Queuing…"
                  : `Send ${preview.length} ${preview.length === 1 ? "email" : "emails"}`}
              </button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}

export function SalesMailbox() {
  const [items, setItems] = useState<SalesEmail[]>([]);
  const [fullMessage, setFullMessage] = useState<SalesEmailDetail | null>(null);
  const [thread, setThread] = useState<SalesEmail[]>([]);
  const [threadError, setThreadError] = useState(false);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<SalesEmail | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const selectedDetail =
    fullMessage?.id === selectedId ? fullMessage : selected;

  const load = useCallback(async (needle = "", selectedFolder = "") => {
    setBusy(true);
    setError(null);
    try {
      const page = await listSalesEmails({
        search: needle,
        folder: selectedFolder || undefined,
      });
      setItems(page.items);
      setTotal(page.total);
      setSelectedId((current) =>
        current && page.items.some((item) => item.id === current)
          ? current
          : null,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load mail");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    listSalesEmailFolders()
      .then(setFolders)
      .catch(() => setFolders([]));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setFullMessage(null);
      setThread([]);
      setThreadError(false);
      return;
    }
    let cancelled = false;
    setFullMessage(null);
    setThread([]);
    setThreadError(false);
    getSalesEmail(selectedId)
      .then((message) => {
        if (!cancelled) setFullMessage(message);
      })
      .catch(() => undefined);
    getSalesEmailThread(selectedId)
      .then((messages) => {
        if (!cancelled) setThread(messages);
      })
      .catch(() => {
        if (!cancelled) setThreadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function sync() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await syncSalesMailbox();
      setNotice(
        `Checked ${result.checked} messages in ${result.folders} folders; ${result.imported} added.`,
      );
      setFolders(await listSalesEmailFolders());
      await load(search, folder);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mailbox sync failed");
    } finally {
      setBusy(false);
    }
  }

  async function downloadAttachment(messageId: string, attachmentId: string) {
    try {
      const { url } = await getSalesEmailAttachmentDownload(
        messageId,
        attachmentId,
      );
      window.location.assign(url);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Attachment could not be downloaded",
      );
    }
  }

  async function unsubscribeSender(message: SalesEmail) {
    if (
      !window.confirm(
        `Stop future sales emails to ${message.fromEmail}? This also applies to queued mail.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await unsubscribeSalesEmailSender(message.id);
      setFullMessage((current) =>
        current?.id === message.id
          ? { ...current, senderSuppressed: true }
          : current,
      );
      setNotice(`${message.fromEmail} will not receive future sales emails.`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not suppress sender",
      );
    } finally {
      setBusy(false);
    }
  }

  async function retryFailedMessage(message: SalesEmail) {
    const recipient = message.to[0]?.email;
    if (!recipient || !window.confirm(`Queue a retry to ${recipient}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await retrySalesEmail(message.id);
      setNotice("The failed email was queued for retry.");
      await load(search, folder);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not retry email",
      );
    } finally {
      setBusy(false);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(search, folder);
  }

  async function loadMore() {
    setBusy(true);
    setError(null);
    try {
      const page = await listSalesEmails({
        search,
        folder: folder || undefined,
        offset: items.length,
      });
      setItems((current) => [...current, ...page.items]);
      setTotal(page.total);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load more mail",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={styles.mailWorkspace}
      aria-labelledby="sales-mail-title"
    >
      <SalesEmailComposer
        clearReply={() => setReplyTo(null)}
        onQueued={() => void load(search, folder)}
        replyTo={replyTo}
      />
      <header className={styles.mailWorkspaceHeader}>
        <div>
          <h2 id="sales-mail-title">Sales mailbox</h2>
          <p>Incoming and sent messages synced from sales@bjhlogistics.com.</p>
        </div>
        <button
          className={styles.primaryButton}
          disabled={busy}
          onClick={() => void sync()}
          type="button"
        >
          {busy ? "Working…" : "Sync mailbox"}
        </button>
      </header>

      {notice && (
        <p className={styles.mailNotice} role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className={styles.mailError} role="alert">
          {error}
        </p>
      )}

      <form className={styles.mailSearch} onSubmit={submitSearch}>
        <label htmlFor="sales-mail-search">
          Search message, sender or subject
        </label>
        <input
          id="sales-mail-search"
          maxLength={200}
          onChange={(event) => setSearch(event.target.value)}
          value={search}
        />
        <label htmlFor="sales-mail-folder">Folder</label>
        <select
          id="sales-mail-folder"
          onChange={(event) => {
            setFolder(event.target.value);
            void load(search, event.target.value);
          }}
          value={folder}
        >
          <option value="">All folders</option>
          {folders.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <button
          className={styles.secondaryButton}
          disabled={busy}
          type="submit"
        >
          Search
        </button>
        <span>{total} messages</span>
      </form>

      <div className={styles.mailWorkspaceGrid}>
        <div aria-label="Messages" className={styles.mailList}>
          {items.map((item) => (
            <button
              aria-current={selectedId === item.id ? "true" : undefined}
              className={`${styles.mailListItem}${selectedId === item.id ? ` ${styles.mailListItemSelected}` : ""}`}
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              type="button"
            >
              <span className={styles.mailListItemTop}>
                <strong>
                  {item.direction === "incoming"
                    ? item.fromName || item.fromEmail
                    : `To ${item.to[0]?.email ?? "recipient"}`}
                </strong>
                <time>{messageDate(item)}</time>
              </span>
              <span className={styles.mailListSubject}>
                {item.subject || "(no subject)"}
              </span>
              <span className={styles.mailListPreview}>
                {item.body.slice(0, 130)}
                {item.bodyTruncated ? "…" : ""}
              </span>
              <span className={styles.mailListMeta}>
                {item.direction === "incoming" ? "Received" : "Outgoing"}
                {item.source === "platform"
                  ? ` · ${item.sendStatus}`
                  : " · mailbox"}
              </span>
            </button>
          ))}
          {items.length === 0 && !busy && (
            <div className={styles.mailEmpty}>
              <strong>No messages found</strong>
              <p>Sync the mailbox to load its incoming and sent mail.</p>
            </div>
          )}
          {items.length < total && (
            <button
              className={styles.mailMore}
              disabled={busy}
              onClick={() => void loadMore()}
              type="button"
            >
              {busy ? "Loading…" : "Load more messages"}
            </button>
          )}
        </div>

        <article aria-live="polite" className={styles.mailDetail}>
          {selectedDetail ? (
            <>
              <p className={styles.mailDirection}>
                {selectedDetail.direction === "incoming"
                  ? "Received"
                  : "Outgoing"}{" "}
                · {messageDate(selectedDetail)}
              </p>
              <h3>{selectedDetail.subject || "(no subject)"}</h3>
              <dl className={styles.mailHeaders}>
                <div>
                  <dt>From</dt>
                  <dd>
                    {selectedDetail.fromName
                      ? `${selectedDetail.fromName} <${selectedDetail.fromEmail}>`
                      : selectedDetail.fromEmail}
                  </dd>
                </div>
                <div>
                  <dt>To</dt>
                  <dd>
                    {selectedDetail.to
                      .map((address) => address.email)
                      .join(", ") || "—"}
                  </dd>
                </div>
                {selectedDetail.cc.length > 0 && (
                  <div>
                    <dt>CC</dt>
                    <dd>
                      {selectedDetail.cc
                        .map((address) => address.email)
                        .join(", ")}
                    </dd>
                  </div>
                )}
                {selectedDetail.sendStatus !== "mailbox" && (
                  <div>
                    <dt>Status</dt>
                    <dd>
                      {selectedDetail.sendStatus}
                      {selectedDetail.error ? ` · ${selectedDetail.error}` : ""}
                    </dd>
                  </div>
                )}
              </dl>
              <pre className={styles.mailBody}>
                {selectedDetail.body || "(No plain-text body)"}
              </pre>
              {fullMessage?.id === selectedDetail.id &&
                fullMessage.attachments.length > 0 && (
                  <section aria-label="Attachments">
                    <h4>Attachments</h4>
                    <ul>
                      {fullMessage.attachments.map((attachment) => (
                        <li key={attachment.id}>
                          {attachment.available ? (
                            <button
                              className={styles.secondaryButton}
                              onClick={() =>
                                void downloadAttachment(
                                  fullMessage.id,
                                  attachment.id,
                                )
                              }
                              type="button"
                            >
                              Download {attachment.filename}
                            </button>
                          ) : (
                            `${attachment.filename} · too large to store`
                          )}
                          {` · ${(attachment.sizeBytes / 1024).toFixed(0)} KB`}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              {threadError && (
                <p className={styles.mailError}>
                  Conversation could not be loaded.
                </p>
              )}
              {thread.length > 1 && (
                <section aria-label="Conversation">
                  <h4>
                    Conversation ·{" "}
                    {thread.length === 100
                      ? "First 100 messages"
                      : `${thread.length} messages`}
                  </h4>
                  {thread
                    .filter((message) => message.id !== selectedDetail.id)
                    .map((message) => (
                      <details key={message.id}>
                        <summary>
                          {message.direction === "incoming"
                            ? message.fromEmail
                            : `To ${message.to[0]?.email ?? "recipient"}`}{" "}
                          · {messageDate(message)} ·{" "}
                          {message.subject || "(no subject)"}
                        </summary>
                        <p>Status: {message.sendStatus}</p>
                        <pre className={styles.mailBody}>
                          {message.body || "(No plain-text body)"}
                        </pre>
                      </details>
                    ))}
                </section>
              )}
              {selectedDetail.direction === "incoming" &&
                selectedDetail.messageId && (
                  <button
                    className={styles.secondaryButton}
                    onClick={() => setReplyTo(selectedDetail)}
                    type="button"
                  >
                    Reply
                  </button>
                )}
              {fullMessage?.id === selectedDetail.id &&
                selectedDetail.direction === "incoming" &&
                (fullMessage.senderSuppressed ? (
                  <p className={styles.mailNotice}>
                    This address is suppressed from sales emails.
                  </p>
                ) : (
                  <button
                    className={styles.secondaryButton}
                    disabled={busy}
                    onClick={() => void unsubscribeSender(selectedDetail)}
                    type="button"
                  >
                    Stop sales emails to this sender
                  </button>
                ))}
              {selectedDetail.source === "platform" &&
                selectedDetail.sendStatus === "failed" && (
                  <button
                    className={styles.secondaryButton}
                    disabled={busy}
                    onClick={() => void retryFailedMessage(selectedDetail)}
                    type="button"
                  >
                    Retry failed email
                  </button>
                )}
            </>
          ) : (
            <div className={styles.mailEmpty}>
              <strong>Select a message</strong>
              <p>Message details will appear here.</p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
