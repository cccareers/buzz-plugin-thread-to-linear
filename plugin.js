// src/plugin.tsx
var inject = ["react", "conversation"];
var MAX_TITLE = 120;
var MAX_LINK_LENGTH = 7500;
var EVENT_ID = /^[0-9a-f]{64}$/;
var CHANNEL_ID = /^[A-Za-z0-9_-]{1,128}$/;
var LINEAR_NEW = "https://linear.app/new";
function isSourceMessage(message) {
  return EVENT_ID.test(message.id) && CHANNEL_ID.test(message.channelId) && (!message.threadRootId || EVENT_ID.test(message.threadRootId)) && (!message.delivery || message.delivery === "accepted" || message.delivery === "seen") && !message.membership && !message.huddle && !message.audience && !message.notice;
}
function limit(value, length) {
  const characters = Array.from(value.slice(0, length * 2 + 2));
  return characters.length <= length ? value : `${characters.slice(0, length - 1).join("").trimEnd()}\u2026`;
}
function escapeMarkdown(value) {
  return value.replace(/[\\`*_{}\[\]()<>#+.!|~-]/g, "\\$&");
}
function makeDraft(selected, root, replies, partial) {
  const context = replies.filter((row) => row.id !== selected.id && row.id !== root?.id && isSourceMessage(row) && row.content.trim());
  const rows = [root, ...context.slice(-3), selected].filter((row) => !!row && isSourceMessage(row)).filter((row, index, all) => all.findIndex((item) => item.id === row.id) === index).sort((a, b) => (a.createdAtMs ?? a.createdAt * 1e3) - (b.createdAtMs ?? b.createdAt * 1e3));
  const excerpts = rows.flatMap((row) => {
    const text = limit(row.content.trim().replace(/\s+/g, " "), 180);
    if (!text) return [];
    const label = row.id === selected.id ? "Selected message" : row.id === root?.id ? "Thread opener" : "Reply";
    return [`> **${label}** \u2014 ${escapeMarkdown(text)}`];
  });
  const firstLine = selected.content.trim().split(/\r?\n/, 1)[0]?.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+)/, "").trim();
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
    ...excerpts.length ? ["## Buzz context", excerpts.join("\n>\n")] : [],
    "## Source",
    `[${source.href}](${source.href})`
  ].join("\n\n");
  const notice = partial ? "The complete thread context was unavailable. Review the available excerpts." : "Review the excerpts and fill in the acceptance criteria before sharing.";
  return { title, description, notice };
}
async function loadDraft(session, selected, signal) {
  const rootId = selected.threadRootId ?? selected.id;
  const view = session.thread(selected.channelId, rootId);
  const dispose = () => view.dispose();
  signal.addEventListener("abort", dispose, { once: true });
  try {
    await view.refresh();
    signal.throwIfAborted();
    const snapshot = view.snapshot();
    if (snapshot.status !== "ready" || !snapshot.root || snapshot.root.id !== rootId) {
      return makeDraft(selected, void 0, [], true);
    }
    const replies = snapshot.replies.filter((row) => row.channelId === selected.channelId && row.threadRootId === rootId);
    return makeDraft(selected, snapshot.root, replies, snapshot.limited);
  } finally {
    signal.removeEventListener("abort", dispose);
    if (!signal.aborted) dispose();
  }
}
function linearUrl(title, description) {
  const url = new URL(LINEAR_NEW);
  url.searchParams.set("title", title);
  url.searchParams.set("description", description);
  return url.href;
}
async function copyDraft(text) {
  const native = window.__TAURI_INTERNALS__;
  if (native) {
    await native.invoke("clipboard_write_text", { text });
    return;
  }
  await navigator.clipboard.writeText(text);
}
async function openExternal(url) {
  const native = window.__TAURI_INTERNALS__;
  if (!native) throw new Error("The Buzz desktop browser opener is unavailable");
  await native.invoke("plugin:opener|open_url", { url });
}
var apply = (ctx) => {
  const React = ctx.react;
  const { useEffect, useId, useRef, useState } = React;
  const DraftDialog = ({ message, session, close }) => {
    const dialog = useRef(null);
    const headingId = useId();
    const [draft, setDraft] = useState();
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
          if (!controller.signal.aborted) setDraft(makeDraft(message, void 0, [], true));
        }
      );
      return () => controller.abort();
    }, [session, message.id]);
    const title = draft?.title.trim() ?? "";
    const url = draft && title ? linearUrl(title, draft.description) : void 0;
    const tooLong = url !== void 0 && url.length > MAX_LINK_LENGTH;
    const copy = async () => {
      if (!draft || !title || busy) return;
      setBusy(true);
      setNotice("");
      try {
        await copyDraft(`# ${title}

${draft.description}`);
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
        setNotice("Couldn\u2019t open Linear. Copy the draft and open Linear in your browser.");
      } finally {
        setBusy(false);
      }
    };
    return /* @__PURE__ */ React.createElement(
      "dialog",
      {
        ref: dialog,
        "aria-labelledby": headingId,
        onCancel: (event) => {
          event.preventDefault();
          close();
        },
        style: {
          width: "min(36rem, calc(100vw - 2rem))",
          maxHeight: "calc(100vh - 2rem)",
          boxSizing: "border-box",
          margin: "auto",
          padding: "var(--space-5, 1.25rem)",
          border: "1px solid var(--border-standard)",
          borderRadius: "var(--radius-panel, 0.75rem)",
          background: "var(--surface-panel)",
          color: "var(--text-standard)"
        }
      },
      /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: "var(--space-4, 1rem)" } }, /* @__PURE__ */ React.createElement("h2", { className: "text-label", id: headingId }, "Draft Linear issue"), draft ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "text-body-sm text-subtle" }, draft.notice), /* @__PURE__ */ React.createElement("label", { className: "text-label-sm", style: { display: "grid", gap: "0.25rem" } }, "Title", /* @__PURE__ */ React.createElement(
        "input",
        {
          className: "buzz-input",
          "data-buzz-ui": "",
          "data-size": "md",
          value: draft.title,
          maxLength: MAX_TITLE,
          onChange: (event) => {
            setDraft({ ...draft, title: event.target.value });
            setNotice("");
          }
        }
      )), /* @__PURE__ */ React.createElement("label", { className: "text-label-sm", style: { display: "grid", gap: "0.25rem" } }, "Description (Markdown)", /* @__PURE__ */ React.createElement(
        "textarea",
        {
          className: "buzz-textarea",
          "data-buzz-ui": "",
          "data-surface": "inset",
          "data-variant": "text",
          rows: 11,
          value: draft.description,
          onChange: (event) => {
            setDraft({ ...draft, description: event.target.value });
            setNotice("");
          }
        }
      )), /* @__PURE__ */ React.createElement("p", { className: "text-body-sm text-subtle" }, tooLong ? "The draft is too long to prefill. Copy it, open the blank form, and paste it there." : "Opening the form sends these fields to Linear in the browser URL.")) : /* @__PURE__ */ React.createElement("p", { className: "text-body-sm text-subtle", role: "status" }, "Loading Buzz thread context\u2026"), notice && /* @__PURE__ */ React.createElement("p", { className: "text-body-sm", role: "status" }, notice), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "var(--space-2, 0.5rem)" } }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "buzz-button", "data-buzz-ui": "", "data-size": "sm", "data-variant": "subtle", onClick: close }, "Close"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "buzz-button", "data-buzz-ui": "", "data-size": "sm", "data-variant": "subtle", disabled: !title || busy, onClick: () => void copy() }, "Copy draft"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "buzz-button", "data-buzz-ui": "", "data-size": "sm", "data-variant": "prominent", disabled: !url || busy, onClick: () => void open() }, tooLong ? "Open blank Linear form" : "Open in Linear")))
    );
  };
  ctx.conversation.registerMessageAction({
    id: "draft-linear-issue",
    title: "Draft Linear issue",
    matches: isSourceMessage,
    component: DraftDialog
  });
};
export {
  apply,
  inject
};
