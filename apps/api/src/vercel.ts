/**
 * Vercel Function entrypoint for the API (the "api" service in vercel.json).
 *
 * Docker runs src/index.ts instead: a long-lived server that also migrates on
 * start, serves the web app and runs the hourly jobs. Here none of that
 * happens per request: migrations and plan/super-admin setup run in the build
 * (scripts/vercel-build.ts), the web app is its own static service, and jobs
 * are Vercel Cron calls to /api/cron/*.
 *
 * One Fastify app and one Prisma client are created per function instance and
 * reused by every request it serves.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createPrisma } from './lib/prisma';

let appPromise: Promise<FastifyInstance> | null = null;

function getApp(): Promise<FastifyInstance> {
  appPromise ??= (async () => {
    const app = await buildApp(createPrisma(), loadConfig());
    await app.ready();
    return app;
  })().catch((e) => {
    appPromise = null; // let the next request retry a failed cold start
    throw e;
  });
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  app.server.emit('request', req, res);
}
