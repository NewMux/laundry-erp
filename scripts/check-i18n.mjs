#!/usr/bin/env node
// Verifies that every translation key used in the code exists in
// packages/shared/locales/en.json (so Arabic can later be added key-for-key).
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dict = JSON.parse(fs.readFileSync(path.join(root, 'packages/shared/locales/en.json'), 'utf8'));
const has = (key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), dict) !== undefined;

const files = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) {
      if (!['node_modules', 'dist'].includes(f.name)) walk(p);
    } else if (/\.(tsx?|mts)$/.test(f.name)) files.push(p);
  }
};
['apps/web/src', 'apps/api/src', 'packages/shared/src'].forEach((d) => walk(path.join(root, d)));

const missing = [];
let count = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
    count++;
    if (!has(m[1])) missing.push(`${path.relative(root, f)}: ${m[1]}`);
  }
  // Dynamic keys like t(`orderStatus.${s}`): the prefix must exist as a group.
  for (const m of src.matchAll(/\bt\(\s*`([a-zA-Z0-9_.]+)\.\$\{/g)) {
    count++;
    if (!has(m[1])) missing.push(`${path.relative(root, f)}: ${m[1]}.*`);
  }
}
if (missing.length) {
  console.error(`Missing translation keys (${missing.length}):\n${missing.join('\n')}`);
  process.exit(1);
}
console.log(`i18n OK — ${count} key references checked`);
