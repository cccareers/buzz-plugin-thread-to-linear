import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));

async function project(t, sources) {
  const directory = await mkdtemp(join(tmpdir(), "thread-to-linear-build-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "src"));
  await writeFile(join(directory, "package.json"), '{"type":"module"}');
  await writeFile(join(directory, "build.mjs"), await readFile(join(root, "build.mjs")));
  await symlink(join(root, "node_modules"), join(directory, "node_modules"), "dir");
  for (const [name, contents] of Object.entries(sources)) {
    await writeFile(join(directory, "src", name), contents);
  }
  return directory;
}

test("the committed installable bundle matches a clean build and registers its action", async (t) => {
  const directory = await project(t, {
    "plugin.tsx": await readFile(join(root, "src/plugin.tsx"), "utf8"),
  });
  await exec(process.execPath, [join(directory, "build.mjs")], { cwd: tmpdir() });
  const built = await readFile(join(directory, "plugin.js"), "utf8");
  assert.equal(await readFile(join(root, "plugin.js"), "utf8"), built,
    "Run npm run build and commit plugin.js; Buzz installs this artifact");
  const plugin = await import(`data:text/javascript;base64,${Buffer.from(built).toString("base64")}`);
  assert.deepEqual(plugin.inject, ["react", "conversation"]);
  const actions = [];
  plugin.apply({ react: {}, conversation: { registerMessageAction: (action) => actions.push(action) } });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].id, "draft-linear-issue");
  assert.equal(typeof actions[0].matches, "function");
  assert.equal(typeof actions[0].component, "function");
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.apiVersion, 1);
  assert.match(manifest.id, /^[a-z][a-z0-9.-]+$/);
});

for (const [name, sources, error] of [
  ["missing entry", {}, /Expected exactly one/],
  ["ambiguous entries", { "plugin.ts": "", "plugin.tsx": "" }, /Expected exactly one/],
  ["missing apply export", { "plugin.ts": "export const inject = [];" }, /must export apply and inject/],
  ["missing inject export", { "plugin.ts": "export const apply = () => {};" }, /must export apply and inject/],
  ["external runtime import", {
    "plugin.ts": 'export const inject = []; export const apply = () => import("https://example.invalid/runtime.js");',
  }, /no runtime imports/],
]) {
  test(`build refuses an uninstallable plugin: ${name}`, async (t) => {
    const directory = await project(t, sources);
    await assert.rejects(exec(process.execPath, [join(directory, "build.mjs")]), error);
    await assert.rejects(readFile(join(directory, "plugin.js")), { code: "ENOENT" });
  });
}
