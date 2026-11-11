import type { MessageAction, PluginModule } from "@buzz/author";

export const inject = ["react", "conversation"];

type Message = Parameters<MessageAction["matches"]>[0];
type Session = Parameters<MessageAction["matches"]>[1];
type Draft = Readonly<{ title: string; description: string; notice: string }>;
type NativeWindow = Window & {
  __TAURI_INTERNALS__?: {
    invoke(command: string, args: Record<string, string>): Promise<unknown>;
  };
};

const MAX_TITLE = 120;
const MAX_LINK_LENGTH = 7500;
const EVENT_ID = /^[0-9a-f]{64}$/;
const CHANNEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const LINEAR_NEW = "https://linear.app/new";

function isSourceMessage(message: Message) {
  return (
    EVENT_ID.test(message.id) &&
    CHANNEL_ID.test(message.channelId) &&
    (!message.threadRootId || EVENT_ID.test(message.threadRootId)) &&
    (!message.delivery || message.delivery === "accepted" || message.delivery === "seen") &&
    !message.membership &&
    !message.huddle &&
    !message.audience &&
    !message.notice
  );
}

function limit(value: string, length: number) {
  // Slice by code point so truncation never inserts half of a surrogate pair.
  const characters = Array.from(value.slice(0, length * 2 + 2));
  return characters.length <= length
    ? value
    : `${characters.slice(0, length - 1).join("").trimEnd()}…`;
}

function escapeMarkdown(value: string) {
  return value.replace(/[\\`*_{}\[\]()<>#+.!|~-]/g, "\\$&");
}

function makeDraft(selected: Message, root: Message | undefined, replies: readonly Message[], partial: boolean): Draft {
  const context = replies.filter((row) => row.id !== selected.id && row.id !== root?.id && isSourceMessage(row) && row.content.trim());
  const rows = [root, ...context.slice(-3), selected]
    .filter((row): row is Message => !!row && isSourceMessage(row))
    .filter((row, index, all) => all.findIndex((item) => item.id === row.id) === index)
    .sort((a, b) => (a.createdAtMs ?? a.createdAt * 1000) - (b.createdAtMs ?? b.createdAt * 1000)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const excerpts = rows.flatMap((row) => {
    const text = limit(row.content.trim().replace(/\s+/g, " "), 180);
    if (!text) return [];
    const label = row.id === selected.id ? "Selected message" : row.id === root?.id ? "Thread opener" : "Reply";
    return [`> **${label}** — ${escapeMarkdown(text)}`];
  });
  const firstLine = selected.content.trim().split(/\r?\n/, 1)[0]
    ?.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+)/, "")
    .trim();
  const title = limit(firstLine || "Follow up on Buzz thread", MAX_TITLE);
  const source = new URL("buzz://message");
  source.searchParams.set("channel", selected.channelId);
  source.searchParams.set("id", selected.id);
  if (selected.threadRootId) source.searchParams.set("thread", selected.threadRootId);
  const description = [
    "## What needs to change?",
    "[Describe the problem or requested change.]",
    "## Acceptance criteria",
    "- [ ] [Add a verifiable outcome.]",
    ...(excerpts.length ? ["## Buzz context", excerpts.join("\n>\n")] : []),
    "## Source",
    `[${source.href}](${source.href})`,
  ].join("\n\n");
  const notice = partial
    ? "The complete thread context was unavailable. Review the available excerpts."
    : "Review the excerpts and fill in the acceptance criteria before sharing.";
  return { title, description, notice };
}

async function loadDraft(session: Session, selected: Message, signal: AbortSignal): Promise<Draft> {
  const rootId = selected.threadRootId ?? selected.id;
  const view = session.thread(selected.channelId, rootId);
  const dispose = () => view.dispose();
  signal.addEventListener("abort", dispose, { once: true });
  try {
    await view.refresh();
    signal.throwIfAborted();
    const snapshot = view.snapshot();
    if (snapshot.status !== "ready" || !snapshot.root || snapshot.root.id !== rootId) {
      return makeDraft(selected, undefined, [], true);
    }
    const replies = snapshot.replies.filter((row) => row.channelId === selected.channelId && row.threadRootId === rootId);
    return makeDraft(selected, snapshot.root, replies, snapshot.limited || snapshot.canLoadMore);
  } finally {
    signal.removeEventListener("abort", dispose);
    if (!signal.aborted) dispose();
  }
}

function linearUrl(title: string, description: string) {
  const url = new URL(LINEAR_NEW);
  url.searchParams.set("title", title);
  url.searchParams.set("description", description);
  return url.href;
}

async function copyDraft(text: string) {
  const native = (window as NativeWindow).__TAURI_INTERNALS__;
  if (native) {
    await native.invoke("clipboard_write_text", { text });
    return;
  }
  await navigator.clipboard.writeText(text);
}

async function openExternal(url: string) {
  const native = (window as NativeWindow).__TAURI_INTERNALS__;
  if (!native) throw new Error("The Buzz desktop browser opener is unavailable");
  await native.invoke("plugin:opener|open_url", { url });
}

export const apply: PluginModule["apply"] = (ctx) => {
  const React = ctx.react;
  const { useEffect, useId, useRef, useState } = React;

  const DraftDialog: MessageAction["component"] = ({ message, session, close }) => {
    const dialog = useRef<HTMLDialogElement>(null);
    const headingId = useId();
    const [draft, setDraft] = useState<Draft>();
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);

    useEffect(() => {
      const element = dialog.current;
      if (!element) return;
      const previouslyFocused = document.activeElement;
      element.showModal();
      return () => {
        element.close();
        if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
          previouslyFocused.focus({ preventScroll: true });
        }
      };
    }, []);

    useEffect(() => {
      const controller = new AbortController();
      void loadDraft(session, message, controller.signal).then(
        (result) => {
          if (!controller.signal.aborted) setDraft(result);
        },
        () => {
          if (!controller.signal.aborted) setDraft(makeDraft(message, undefined, [], true));
        },
      );
      return () => controller.abort();
      // Snapshot the message that opened this action. Relay updates must not replace edits.
    }, [session, message.id]);

    const title = draft?.title.trim() ?? "";
    const url = draft && title ? linearUrl(title, draft.description) : undefined;
    const tooLong = url !== undefined && url.length > MAX_LINK_LENGTH;

    const copy = async () => {
      if (!draft || !title || busy) return;
      setBusy(true);
      setNotice("");
      try {
        await copyDraft(`# ${title}\n\n${draft.description}`);
        setNotice("Draft copied.");
      } catch {
        setNotice("Clipboard unavailable. Select and copy the draft fields manually.");
      } finally {
        setBusy(false);
      }
    };

    const open = async () => {
      if (!url || busy) return;
      setBusy(true);
      setNotice("");
      try {
        await openExternal(tooLong ? LINEAR_NEW : url);
        setNotice(tooLong ? "Linear opened. Copy and paste the draft into the issue form." : "Linear opened. Choose a team and submit the issue there.");
      } catch {
        setNotice("Couldn’t open Linear. Copy the draft and open Linear in your browser.");
      } finally {
        setBusy(false);
      }
    };

    return (
      <dialog
        ref={dialog}
        aria-labelledby={headingId}
        onCancel={(event) => { event.preventDefault(); close(); }}
        style={{
          width: "min(36rem, calc(100vw - 2rem))",
          maxHeight: "calc(100vh - 2rem)",
          boxSizing: "border-box",
          margin: "auto",
          padding: "var(--space-5, 1.25rem)",
          border: "1px solid var(--border-standard)",
          borderRadius: "var(--radius-panel, 0.75rem)",
          background: "var(--surface-panel)",
          color: "var(--text-standard)",
        }}
      >
        <div style={{ display: "grid", gap: "var(--space-4, 1rem)" }}>
          <h2 className="text-label" id={headingId}>Draft Linear issue</h2>
          {draft ? (
            <>
              <p className="text-body-sm text-subtle">{draft.notice}</p>
              <label className="text-label-sm" style={{ display: "grid", gap: "0.25rem" }}>
                Title
                <input
                  className="buzz-input" data-buzz-ui="" data-size="md"
                  value={draft.title} maxLength={MAX_TITLE}
                  onChange={(event) => { setDraft({ ...draft, title: event.target.value }); setNotice(""); }}
                />
              </label>
              <label className="text-label-sm" style={{ display: "grid", gap: "0.25rem" }}>
                Description (Markdown)
                <textarea
                  className="buzz-textarea" data-buzz-ui="" data-surface="inset" data-variant="text"
                  rows={11} value={draft.description}
                  onChange={(event) => { setDraft({ ...draft, description: event.target.value }); setNotice(""); }}
                />
              </label>
              <p className="text-body-sm text-subtle">
                {tooLong ? "The draft is too long to prefill. Copy it, open the blank form, and paste it there." : "Opening the form sends these fields to Linear in the browser URL."}
              </p>
            </>
          ) : <p className="text-body-sm text-subtle" role="status">Loading Buzz thread context…</p>}
          {notice && <p className="text-body-sm" role="status">{notice}</p>}
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "var(--space-2, 0.5rem)" }}>
            <button type="button" className="buzz-button" data-buzz-ui="" data-size="sm" data-variant="subtle" onClick={close}>Close</button>
            <button type="button" className="buzz-button" data-buzz-ui="" data-size="sm" data-variant="subtle" disabled={!title || busy} onClick={() => void copy()}>Copy draft</button>
            <button type="button" className="buzz-button" data-buzz-ui="" data-size="sm" data-variant="prominent" disabled={!url || busy} onClick={() => void open()}>
              {tooLong ? "Open blank Linear form" : "Open in Linear"}
            </button>
          </div>
        </div>
      </dialog>
    );
  };

  ctx.conversation.registerMessageAction({
    id: "draft-linear-issue",
    title: "Draft Linear issue",
    matches: isSourceMessage,
    component: DraftDialog,
  });
};
