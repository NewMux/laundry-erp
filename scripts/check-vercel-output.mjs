// After `vercel build`: the API function must carry what it loads at runtime
// by computed paths (serverless Chromium, PDF fonts, Prisma's Linux engine)
// and stay within Vercel's 250 MB function size limit.
import fs from 'node:fs';
import path from 'node:path';

const dir = '.vercel/output/services/api/functions/index.func';
const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.vc-config.json'), 'utf8'));
const files = Object.keys(cfg.filePathMap ?? {});
const need = [
  ['serverless Chromium', /@sparticuz\/chromium\/bin\/chromium\.br$/],
  ['Chromium AL2023 libraries', /@sparticuz\/chromium\/bin\/al2023\.tar\.br$/],
  ['Noto Sans Arabic', /noto-sans-arabic-arabic-400-normal\.woff2$/],
  ['Noto Sans', /noto-sans-latin-700-normal\.woff2$/],
  ['Prisma engine for Vercel', /libquery_engine-rhel-openssl-3\.0\.x\.so\.node$/],
];
let ok = true;
for (const [what, re] of need) {
  if (!files.some((f) => re.test(f))) {
    console.error(`missing from the api function: ${what}`);
    ok = false;
  }
}
let bytes = 0;
for (const src of Object.values(cfg.filePathMap ?? {})) bytes += fs.statSync(src).size;
const mb = Math.round(bytes / 1e6);
console.log(`api function: ${files.length} traced files, ~${mb} MB, region ${cfg.regions}, maxDuration ${cfg.maxDuration}s`);
if (mb > 240) {
  console.error('api function is close to the 250 MB limit');
  ok = false;
}
for (const svc of ['web', 'api']) {
  if (!fs.existsSync(path.join('.vercel/output/services', svc))) {
    console.error(`service output missing: ${svc}`);
    ok = false;
  }
}
process.exit(ok ? 0 : 1);
