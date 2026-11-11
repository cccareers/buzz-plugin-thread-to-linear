# Thread to Linear

Turn a Buzz conversation into an editable issue draft. Open the menu on a delivered message and select **Draft Linear issue**. The draft includes the selected message, the thread opener when available, up to three recent replies from the available context, an acceptance criteria checklist, and a Buzz link to the source. Edit the title and Markdown description before sharing.

- **Copy draft** copies the title and description as Markdown.
- **Open in Linear** passes the edited title and description to the [Linear issue form](https://linear.app/developers/create-issues-using-linear-new) in your default browser. Sign in to Linear, choose the team, and submit the issue there. For a draft too large to prefill, use **Copy draft** and **Open blank Linear form**, then paste the draft.

Buzz reads a bounded view of the current thread using your existing access. Attachments, system messages, and agent-only messages are excluded from the excerpts. The draft lives in the open editor. Opening the prefilled form puts the edited content in the browser URL. The source link opens against the selected Buzz community and requires access to the conversation.

Submitting the issue requires a Linear account. The plugin uses your browser sign-in.

## Install in Buzz desktop v1.0.0

For a local checkout, open **Settings → Plugins → Manage plugins → Add**, choose **Browse** under **Add from folder**, and select this repository’s root. Review the plugin and select **Install plugin**.

Once the GitHub repository is available, paste the following URL into **Git or GitHub repository** in the same dialog, select **Find**, then review and install the plugin.

`https://github.com/cccareers/buzz-plugin-thread-to-linear`

## Build

Use Node.js 20 or later.

```sh
npm ci
npm run build
```

The build writes the self-contained `plugin.js` beside `manifest.json`. Commit the rebuilt file when you change the plugin. Buzz’s Git installer reads the committed bundle. `npm ci` also installs the pinned Buzz author types for editors.

## Test

```sh
npm ci
npx playwright install chromium webkit
npm test
```

On Linux, use `npx playwright install --with-deps chromium webkit` to install browser system dependencies too. After changing plugin source, run `npm run build` before testing.

`npm test` checks TypeScript, verifies the committed bundle matches a clean build, exercises build rejection paths, and runs the shipped `plugin.js` in Chromium and WebKit. The browser suite uses real React and native HTML dialogs with a local Buzz host fixture. It covers message eligibility, bounded excerpts, edits, clipboard and Linear URL payloads, unavailable context, failed native calls, and dialog cleanup. Run `npm run test:e2e -- --project=chromium` for a focused browser run. Failed browser tests retain traces and screenshots in `test-results/`; CI uploads them as artifacts.

The fixtures replace the Buzz relay session, native clipboard/browser bridge, and browser clipboard. Tests never contact Linear or submit issues. Passing these tests verifies plugin behavior at those interfaces; it does not verify Buzz installation, native OS permissions, community authorization, or Linear's authenticated form. Before a release, install the committed bundle in Buzz desktop and check a delivered message in both a channel and a thread, copy an edited draft, open the prefilled Linear form, verify the source link in the intended community, and try the oversized-draft fallback. Creating a Linear issue is a separate manual action.
