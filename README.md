# Thread to Linear

Turn a Buzz conversation into an editable issue draft. Open the menu on a delivered message and select **Draft Linear issue**. The draft includes the selected message, the thread opener when available, up to three recent replies, an acceptance criteria checklist, and a Buzz link to the source. Edit the title and Markdown description before sharing.

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
