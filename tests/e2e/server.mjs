import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const { outputFiles } = await build({ entryPoints: ['tests/e2e/harness.tsx'], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['/plugin.js'] });
const html = '<!doctype html><html><head><meta charset="utf-8"><title>Buzz host fixture</title></head><body><button id="launcher">Message menu</button><main id="root"></main><script type="module" src="/harness.js"></script></body></html>';
createServer(async (req, res) => {
  if (req.url === '/harness.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(outputFiles[0].text); }
  else if (req.url === '/plugin.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile('plugin.js')); }
  else if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); }
  else { res.statusCode = 404; res.end(); }
}).listen(43817, '127.0.0.1');
