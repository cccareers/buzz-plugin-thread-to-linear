import * as React from 'react';
import { createRoot } from 'react-dom/client';
// Deliberately import the shipped module at runtime, never src/plugin.tsx.
// @ts-expect-error The shipped JavaScript module is served verbatim by server.mjs.
const plugin = await import(/* @vite-ignore */ '/plugin.js');
const actions: any[] = [];
plugin.apply({ react: React, conversation: { registerMessageAction: (action: any) => actions.push(action) } });
const action = actions[0];
let root: ReturnType<typeof createRoot> | undefined;
let session: any;
let options: any;
let resolveRefresh: () => void;
let rejectRefresh: () => void;
let resolveNative: () => void;
const stats = { thread: [] as unknown[], refresh: 0, snapshot: 0, dispose: 0, close: 0 };
const calls: any[] = [];
function render(message: any) {
  root!.render(React.createElement(action.component, { message, session, canOpen: () => false, open: () => false, close() { stats.close++; root?.unmount(); root = undefined; } }));
}
(window as any).harness = {
  registration: { inject: plugin.inject, count: actions.length, id: action.id, title: action.title, placement: action.placement },
  stats, calls,
  matches: (message: any) => action.matches(message, session),
  mount(value: any) {
    options = value;
    Object.assign(stats, { thread: [], refresh: 0, snapshot: 0, dispose: 0, close: 0 }); calls.length = 0;
    const invoke = async (command: string, args: any) => {
      calls.push({ command, args });
      if (options.native === 'reject') throw new Error('Native boundary failed');
      if (options.native === 'pending') await new Promise<void>(resolve => { resolveNative = resolve; });
    };
    (window as any).__TAURI_INTERNALS__ = value.native === 'absent' ? undefined : { invoke };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(text: string) {
      calls.push({ command: 'web:clipboard', args: { text } });
      if (options.clipboard === 'reject') throw new Error('Clipboard denied');
    } } });
    session = { thread(channelId: string, rootId: string) {
      stats.thread.push({ channelId, rootId });
      if (options.threadThrows) throw new Error("Cannot create thread view");
      return {
        snapshot() { stats.snapshot++; return options.snapshot; },
        async refresh() {
          stats.refresh++;
          if (options.refresh === 'reject') throw new Error('Relay unavailable');
          if (options.refresh === 'pending') await new Promise<void>((resolve, reject) => { resolveRefresh = resolve; rejectRefresh = () => reject(new Error('Relay unavailable')); });
        },
        subscribe() { return () => {}; }, async loadMore() {}, async retarget() { return 'unavailable'; },
        dispose() { stats.dispose++; },
      };
    } };
    const launcher = document.getElementById('launcher')!;
    launcher.onclick = () => {
      if (!action.matches(value.message, session) || root) return;
      launcher.focus();
      root = createRoot(document.getElementById('root')!);
      render(value.message);
    };
  },
  rerender: render,
  unmount() { root?.unmount(); root = undefined; },
  resolveRefresh: () => resolveRefresh(), rejectRefresh: () => rejectRefresh(), resolveNative: () => resolveNative(),
};
