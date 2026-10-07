// Boots the built Vercel API function the way Vercel does and calls /api/health.
//
// Run after `vercel build`. The function is assembled from
// .vercel/output/services/api/functions/index.func plus every traced file in
// its .vc-config.json filePathMap, in a temp directory outside the repo, so
// it can only load what Vercel would ship. Node runs with
// --no-experimental-require-module, like Vercel's launcher: a CommonJS
// package that require()s an ESM-only one must fail here as it does there.
// Needs DATABASE_URL pointing at a reachable Postgres (health runs SELECT 1).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const funcDir = '.vercel/output/services/api/functions/index.func';
const cfg = JSON.parse(fs.readFileSync(path.join(funcDir, '.vc-config.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-api-'));
fs.cpSync(funcDir, dir, { recursive: true, dereference: true });
for (const [rel, src] of Object.entries(cfg.filePathMap ?? {})) {
  const dest = path.join(dir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // Workspace packages appear as symlinked directories (node_modules/@laundry/shared).
  if (fs.statSync(src).isDirectory()) fs.cpSync(src, dest, { recursive: true, dereference: true });
  else fs.copyFileSync(src, dest);
}

const port = 3990;
const harness = path.join(dir, '__smoke.mjs');
fs.writeFileSync(
  harness,
  `import http from 'node:http';
const mod = await import(${JSON.stringify(path.join(dir, cfg.handler))});
const handler = typeof mod.default === 'function' ? mod.default : mod.default?.default;
if (typeof handler !== 'function') throw new Error('handler is not a function');
http.createServer((req, res) => handler(req, res)).listen(${port}, () => console.log('listening'));
`,
);

const child = spawn(process.execPath, ['--no-experimental-require-module', harness], {
  cwd: dir,
  env: {
    PATH: process.env.PATH,
    HOME: os.tmpdir(),
    VERCEL: '1',
    NODE_ENV: 'production',
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    APP_SECRET: 'smoke-test-secret-smoke-test-secret',
    LOG_LEVEL: 'warn',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (output += d));
let exited = false;
child.on('exit', () => (exited = true));

let ok = false;
let last = '';
for (let i = 0; i < 60 && !exited && !last; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    last = `${res.status} ${await res.text()}`;
    ok = res.status === 200;
  } catch {
    /* not listening yet */
  }
}
child.kill();
fs.rmSync(dir, { recursive: true, force: true });
if (!ok) {
  console.error(`Vercel API function did not answer /api/health with 200 (last: ${last || 'no response'})\n${output.slice(-4000)}`);
  process.exit(1);
}
console.log(`Vercel API function boots: /api/health → ${last}`);
