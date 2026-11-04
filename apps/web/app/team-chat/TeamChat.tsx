"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { ErrorPopup } from "../ErrorPopup";
import {
  addGroupMember,
  createGroup,
  leaveGroup,
  listTeamConversations,
  listTeamPeople,
  openTeamConversation,
  searchTeamTags,
  sendTeamMessage,
  startDirect,
} from "./teamChatApi";
import type {
  TeamConversation,
  TeamConversationSummary,
  TeamMessage,
  TeamPerson,
  TeamTag,
  TeamTagKind,
} from "./teamChatApi";
import jobStyles from "../jobs/jobs.module.css";
import styles from "./teamChat.module.css";

const listEveryMs = 15_000;
const conversationEveryMs = 5_000;

type Pending = { kind: TeamTagKind; id: string; label: string };
type Suggestion = Pending & { note: string };

const kindNotes: Record<TeamTagKind, string> = {
  user: "Person",
  job: "Job",
  invoice: "Invoice",
  document: "Document",
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const shortWhen = (iso: string) =>
  new Date(iso).toDateString() === new Date().toDateString()
    ? time(iso)
    : new Date(iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      });

const teamLabels: Record<string, string> = {
  sales: "Sales",
  customer_service: "Customer Service",
  operations: "Operations",
  finance: "Finance",
};

/** Online now, or when the person was last seen (kept by the API since it last started). */
const presence = (person?: TeamPerson) =>
  !person
    ? ""
    : person.online
      ? "Online"
      : person.lastSeen
        ? `Last seen ${shortWhen(person.lastSeen)}`
        : "Offline";

/** `@ama` or `#BJH/SI` being typed at the end of the message, if any. */
function trigger(text: string) {
  const match = /(^|\s)([@#])([^\s@#]{0,40})$/.exec(text);
  return match ? { symbol: match[2] as "@" | "#", term: match[3] } : null;
}

/**
 * Internal team chat (Evans, 2026-11-02): direct messages, groups and one
 * channel per team. Type @ to mention a colleague and # to tag a job, invoice
 * or document; everyone sees a tag only as far as their own access allows.
 */
export function TeamChat() {
  const [conversations, setConversations] = useState<
    TeamConversationSummary[] | null
  >(null);
  const [people, setPeople] = useState<TeamPerson[]>([]);
  const [selected, setSelected] = useState("");
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [open, setOpen] = useState<TeamConversation | null>(null);
  const [panel, setPanel] = useState<"none" | "direct" | "group">("none");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  // Drafts and chosen tags are kept per conversation, never carried across.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, Pending[]>>({});
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [sending, setSending] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [addPerson, setAddPerson] = useState("");
  const end = useRef<HTMLDivElement>(null);

  const draft = drafts[selected] ?? "";
  const chosen = useMemo(() => pending[selected] ?? [], [pending, selected]);

  const fail = (cause: unknown, fallback: string) =>
    setError(cause instanceof Error ? cause.message : fallback);

  const loadList = useCallback(async () => {
    try {
      setConversations(await listTeamConversations());
    } catch (cause) {
      fail(cause, "Conversations are unavailable");
    }
  }, []);

  const loadOpen = useCallback(async (id: string) => {
    try {
      const loaded = await openTeamConversation(id);
      // A slow answer for the conversation just left must not replace this one.
      if (loaded.id === selectedRef.current) setOpen(loaded);
    } catch (cause) {
      fail(cause, "The conversation could not be opened");
    }
  }, []);

  const loadPeople = useCallback(() => {
    listTeamPeople()
      .then(setPeople)
      .catch((cause: unknown) => fail(cause, "Staff list unavailable"));
  }, []);

  useEffect(() => {
    void loadList();
    loadPeople();
    // The people list also carries who is online, so it refreshes with the list.
    const timer = window.setInterval(() => {
      void loadList();
      loadPeople();
    }, listEveryMs);
    return () => window.clearInterval(timer);
  }, [loadList, loadPeople]);

  useEffect(() => {
    if (!selected) return;
    setOpen((current) => (current?.id === selected ? current : null));
    void loadOpen(selected).then(loadList);
    const timer = window.setInterval(
      () => void loadOpen(selected),
      conversationEveryMs,
    );
    return () => window.clearInterval(timer);
  }, [selected, loadOpen, loadList]);

  const messageCount = open?.messages.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messageCount, selected]);

  // What @ or # at the end of the message could stand for.
  const typing = trigger(draft);
  useEffect(() => {
    setHighlight(0);
    if (!typing) {
      setSuggestions([]);
      return;
    }
    if (typing.symbol === "@") {
      const term = typing.term.toLowerCase();
      setSuggestions(
        people
          .filter((person) => person.name.toLowerCase().includes(term))
          .slice(0, 8)
          .map((person) => ({
            kind: "user",
            id: person.userId,
            label: person.name,
            note: kindNotes.user,
          })),
      );
      return;
    }
    if (typing.term.length < 2) {
      setSuggestions([]);
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      searchTeamTags(typing.term)
        .then((found) => {
          if (current)
            setSuggestions(
              found.map((tag: TeamTag) => ({
                kind: tag.kind,
                id: tag.id,
                label: tag.label,
                note: kindNotes[tag.kind],
              })),
            );
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [typing?.symbol, typing?.term, people]);

  const setDraft = (value: string) =>
    setDrafts((current) => ({ ...current, [selected]: value }));

  function pick(suggestion: Suggestion) {
    const symbol = suggestion.kind === "user" ? "@" : "#";
    setDraft(
      draft.replace(/([@#])([^\s@#]{0,40})$/, `${symbol}${suggestion.label} `),
    );
    setPending((current) => {
      const list = current[selected] ?? [];
      if (
        list.some(
          (tag) => tag.kind === suggestion.kind && tag.id === suggestion.id,
        )
      )
        return current;
      return {
        ...current,
        [selected]: [
          ...list,
          { kind: suggestion.kind, id: suggestion.id, label: suggestion.label },
        ],
      };
    });
    setSuggestions([]);
  }

  function unpick(tag: Pending) {
    setPending((current) => ({
      ...current,
      [selected]: (current[selected] ?? []).filter(
        (item) => !(item.kind === tag.kind && item.id === tag.id),
      ),
    }));
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || !selected || sending) return;
    setSending(true);
    setError("");
    try {
      await sendTeamMessage(
        selected,
        body,
        chosen.map(({ kind, id }) => ({ kind, id })),
      );
      setDrafts((current) => ({ ...current, [selected]: "" }));
      setPending((current) => ({ ...current, [selected]: [] }));
      await loadOpen(selected);
      await loadList();
    } catch (cause) {
      fail(cause, "Sending failed");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlight(
          (current) =>
            (current + step + suggestions.length) % suggestions.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(suggestions[highlight]);
        return;
      }
      if (event.key === "Escape") {
        setSuggestions([]);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  async function earlier() {
    if (!open || open.messages.length === 0) return;
    try {
      const page = await openTeamConversation(
        open.id,
        open.messages[0].createdAt,
      );
      setOpen((current) =>
        current && current.id === page.id
          ? {
              ...current,
              messages: [...page.messages, ...current.messages],
              hasEarlier: page.hasEarlier,
            }
          : current,
      );
    } catch (cause) {
      fail(cause, "Earlier messages could not be loaded");
    }
  }

  async function chatWith(userId: string) {
    setError("");
    try {
      const { id } = await startDirect(userId);
      setPanel("none");
      await loadList();
      setSelected(id);
    } catch (cause) {
      fail(cause, "The conversation could not be started");
    }
  }

  async function makeGroup(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const { id } = await createGroup(groupTitle.trim(), groupMembers);
      setPanel("none");
      setGroupTitle("");
      setGroupMembers([]);
      await loadList();
      setSelected(id);
    } catch (cause) {
      fail(cause, "The group could not be created");
    }
  }

  async function addToGroup(event: FormEvent) {
    event.preventDefault();
    if (!open || !addPerson) return;
    try {
      await addGroupMember(open.id, addPerson);
      setAddPerson("");
      await loadOpen(open.id);
    } catch (cause) {
      fail(cause, "The person could not be added");
    }
  }

  async function leave() {
    if (!open) return;
    try {
      await leaveGroup(open.id);
      setSelected("");
      setOpen(null);
      await loadList();
    } catch (cause) {
      fail(cause, "Leaving the group failed");
    }
  }

  const shown = (conversations ?? []).filter((item) =>
    item.title.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const members = new Set(open?.members.map((member) => member.userId) ?? []);
  const personById = new Map(people.map((person) => [person.userId, person]));
  // Colleagues with no direct chat yet, listed by name under the conversations.
  const talkedTo = new Set(
    (conversations ?? []).flatMap((item) =>
      item.personId ? [item.personId] : [],
    ),
  );
  const others = people.filter(
    (person) =>
      !person.you &&
      !talkedTo.has(person.userId) &&
      person.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const openPerson =
    open?.kind === "direct"
      ? personById.get(
          conversations?.find((item) => item.id === open.id)?.personId ?? "",
        )
      : undefined;

  return (
    <main className={`${jobStyles.page} ${jobStyles.pageWide}`}>
      <ErrorPopup message={error} />
      <div className={styles.shell}>
        <section
          aria-label="Conversations"
          className={`${styles.sidebar} ${selected ? styles.hideOnPhone : ""}`}
        >
          <div className={styles.sidebarHead}>
            <h1>Team chat</h1>
            <div className={styles.headActions}>
              <button
                className={styles.small}
                onClick={() => setPanel(panel === "direct" ? "none" : "direct")}
                type="button"
              >
                New chat
              </button>
              <button
                className={styles.small}
                onClick={() => setPanel(panel === "group" ? "none" : "group")}
                type="button"
              >
                New group
              </button>
            </div>
          </div>

          {panel === "direct" && (
            <div className={styles.form}>
              <strong>Message a colleague</strong>
              <ul className={styles.people}>
                {people.map((person) => (
                  <li key={person.userId}>
                    <button
                      className={styles.suggestion}
                      onClick={() => void chatWith(person.userId)}
                      type="button"
                    >
                      {person.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {panel === "group" && (
            <form
              className={styles.form}
              onSubmit={(event) => void makeGroup(event)}
            >
              <label>
                Group name
                <input
                  maxLength={80}
                  onChange={(event) => setGroupTitle(event.target.value)}
                  required
                  type="text"
                  value={groupTitle}
                />
              </label>
              <ul className={styles.people} aria-label="Members">
                {people.map((person) => (
                  <li key={person.userId}>
                    <label>
                      <input
                        checked={groupMembers.includes(person.userId)}
                        onChange={(event) =>
                          setGroupMembers((current) =>
                            event.target.checked
                              ? [...current, person.userId]
                              : current.filter((id) => id !== person.userId),
                          )
                        }
                        type="checkbox"
                      />
                      {person.name}
                    </label>
                  </li>
                ))}
              </ul>
              <div className={styles.formActions}>
                <button className={styles.send} type="submit">
                  Create group
                </button>
                <button
                  className={styles.small}
                  onClick={() => setPanel("none")}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <input
            aria-label="Search conversations"
            className={styles.search}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search"
            type="search"
            value={filter}
          />
          {conversations === null ? (
            <p className={styles.empty} role="status">
              Loading conversations…
            </p>
          ) : (
            <ul className={styles.list}>
              {shown.map((item) => (
                <li key={item.id}>
                  <button
                    aria-current={item.id === selected}
                    className={`${styles.item} ${
                      item.id === selected ? styles.itemActive : ""
                    }`}
                    onClick={() => setSelected(item.id)}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className={`${styles.avatar} ${
                        item.kind === "team" ? styles.avatarTeam : ""
                      }`}
                    >
                      {item.title.slice(0, 1)}
                      {item.personId &&
                        personById.get(item.personId)?.online && (
                          <span className={styles.online} />
                        )}
                    </span>
                    <span className={styles.itemText}>
                      <span className={styles.itemTitle}>{item.title}</span>
                      <span className={styles.itemPreview}>
                        {item.lastMessage
                          ? `${
                              item.lastMessage.mine
                                ? "You: "
                                : item.kind !== "direct" &&
                                    item.lastMessage.authorName
                                  ? `${item.lastMessage.authorName}: `
                                  : ""
                            }${item.lastMessage.body}`
                          : item.kind === "team"
                            ? "Team channel"
                            : item.personId
                              ? presence(personById.get(item.personId))
                              : "No messages yet"}
                      </span>
                    </span>
                    <span className={styles.itemMeta}>
                      {item.lastMessage &&
                        shortWhen(item.lastMessage.createdAt)}
                      {item.unread > 0 && (
                        <span
                          aria-label={`${item.unread} unread`}
                          className={styles.unread}
                        >
                          {item.unread}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
              {others.map((person) => (
                <li key={person.userId}>
                  <button
                    className={styles.item}
                    onClick={() => void chatWith(person.userId)}
                    type="button"
                  >
                    <span aria-hidden="true" className={styles.avatar}>
                      {person.name.slice(0, 1)}
                      {person.online && <span className={styles.online} />}
                    </span>
                    <span className={styles.itemText}>
                      <span className={styles.itemTitle}>{person.name}</span>
                      <span className={styles.itemPreview}>
                        {presence(person)}
                        {person.teams.length > 0 &&
                          ` · ${person.teams
                            .map((team) => teamLabels[team] ?? team)
                            .join(", ")}`}
                      </span>
                    </span>
                    <span className={styles.itemMeta} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-label="Conversation"
          className={`${styles.panel} ${selected ? "" : styles.hideOnPhone}`}
        >
          {!selected || !open ? (
            <p className={styles.empty}>
              {selected
                ? "Opening…"
                : "Choose a conversation, or start a new chat or group."}
            </p>
          ) : (
            <>
              <div className={styles.panelHead}>
                <button
                  className={styles.back}
                  onClick={() => setSelected("")}
                  type="button"
                >
                  ‹ Back
                </button>
                <div className={styles.panelTitle}>
                  <strong>{open.title}</strong>
                  <span>
                    {open.kind === "team"
                      ? "Team channel: everyone in this team"
                      : open.kind === "group"
                        ? `${open.members.length} members`
                        : presence(openPerson) || "Direct message"}
                  </span>
                </div>
                {open.kind === "group" && (
                  <>
                    <form onSubmit={(event) => void addToGroup(event)}>
                      <select
                        aria-label="Add a person"
                        onChange={(event) => setAddPerson(event.target.value)}
                        value={addPerson}
                      >
                        <option value="">Add a person</option>
                        {people
                          .filter((person) => !members.has(person.userId))
                          .map((person) => (
                            <option key={person.userId} value={person.userId}>
                              {person.name}
                            </option>
                          ))}
                      </select>{" "}
                      <button
                        className={styles.small}
                        disabled={!addPerson}
                        type="submit"
                      >
                        Add
                      </button>
                    </form>
                    <button
                      className={styles.small}
                      onClick={() => void leave()}
                      type="button"
                    >
                      Leave group
                    </button>
                  </>
                )}
              </div>

              <div className={styles.messages} aria-live="polite">
                {open.hasEarlier && (
                  <button
                    className={`${styles.small} ${styles.earlier}`}
                    onClick={() => void earlier()}
                    type="button"
                  >
                    Show earlier messages
                  </button>
                )}
                {open.messages.length === 0 && (
                  <p className={styles.empty}>
                    No messages yet. Say hello, mention someone with @, or tag a
                    job or invoice with #.
                  </p>
                )}
                {open.messages.map((message, index) => (
                  <MessageView
                    key={message.id}
                    message={message}
                    newDay={
                      index === 0 ||
                      day(open.messages[index - 1].createdAt) !==
                        day(message.createdAt)
                    }
                    showAuthor={open.kind !== "direct"}
                  />
                ))}
                <div ref={end} />
              </div>

              <form
                className={styles.composer}
                onSubmit={(event) => void send(event)}
              >
                {suggestions.length > 0 && (
                  <ul className={styles.suggestions} role="listbox">
                    {suggestions.map((suggestion, index) => (
                      <li key={`${suggestion.kind}:${suggestion.id}`}>
                        <button
                          aria-selected={index === highlight}
                          className={`${styles.suggestion} ${
                            index === highlight ? styles.suggestionActive : ""
                          }`}
                          onClick={() => pick(suggestion)}
                          role="option"
                          type="button"
                        >
                          <span>{suggestion.label}</span>
                          <small>{suggestion.note}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {chosen.length > 0 && (
                  <div className={styles.tags} aria-label="Tagged">
                    {chosen.map((tag) => (
                      <button
                        className={styles.tag}
                        key={`${tag.kind}:${tag.id}`}
                        onClick={() => unpick(tag)}
                        title="Remove this tag"
                        type="button"
                      >
                        {kindNotes[tag.kind]}: {tag.label} ×
                      </button>
                    ))}
                  </div>
                )}
                <div className={styles.composerRow}>
                  <textarea
                    aria-label="Message"
                    maxLength={4000}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Message… (@ to mention, # for a job, invoice or document)"
                    rows={1}
                    value={draft}
                  />
                  <button
                    className={styles.send}
                    disabled={sending || !draft.trim()}
                    type="submit"
                  >
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
                <p className={styles.hint}>
                  Enter sends, Shift+Enter starts a new line. Messages are kept
                  as sent.
                </p>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function MessageView({
  message,
  newDay,
  showAuthor,
}: {
  message: TeamMessage;
  newDay: boolean;
  showAuthor: boolean;
}) {
  const tags = message.tags.length > 0 && (
    <div className={styles.tags}>
      {message.tags.map((tag) =>
        tag.href ? (
          <Link
            className={styles.tag}
            href={tag.href}
            key={`${tag.kind}:${tag.id}`}
          >
            {kindNotes[tag.kind]}: {tag.label}
          </Link>
        ) : (
          <span
            className={`${styles.tag} ${tag.kind === "user" ? "" : styles.tagClosed}`}
            key={`${tag.kind}:${tag.id}`}
          >
            {tag.kind === "user" ? `@${tag.label}` : tag.label}
          </span>
        ),
      )}
    </div>
  );
  return (
    <>
      {newDay && (
        <span className={styles.dayDivider}>{day(message.createdAt)}</span>
      )}
      {message.authorUserId === null ? (
        <div className={styles.system}>
          <p className={styles.body}>{message.body}</p>
          {tags}
          <p className={styles.time}>{time(message.createdAt)}</p>
        </div>
      ) : (
        <article
          className={`${styles.bubble} ${message.mine ? styles.mine : styles.theirs}`}
        >
          {showAuthor && !message.mine && (
            <p className={styles.author}>
              {message.authorName ?? "Staff member"}
            </p>
          )}
          <p className={styles.body}>{message.body}</p>
          {tags}
          <p className={styles.time}>{time(message.createdAt)}</p>
        </article>
      )}
    </>
  );
}
