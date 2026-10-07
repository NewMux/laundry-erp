#!/usr/bin/env node
// Runs the Prisma CLI with DIRECT_URL defaulting to DATABASE_URL, so Docker,
// CI and local dev (one plain Postgres URL) keep working while Supabase can
// use a separate direct/session connection for migrations.
//   node --env-file-if-exists=.env scripts/prisma.mjs migrate deploy
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

if (!process.env.DIRECT_URL && process.env.DATABASE_URL) process.env.DIRECT_URL = process.env.DATABASE_URL;
const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const r = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
