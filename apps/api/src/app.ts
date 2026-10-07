import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AppConfig } from './config';
import { loadAuth, requireTenant, scopedDb } from './lib/context';
import { AppError } from './lib/errors';
import { createStorage, type FileStorage } from './lib/storage';
import type { TenantDb } from './lib/tenant-db';
import { closePdf } from './pdf/render';

import authRoutes from './modules/auth.routes';
import platformRoutes from './modules/platform.routes';
import onboardingRoutes from './modules/onboarding.routes';
import settingsRoutes from './modules/settings.routes';
import usersRoutes from './modules/users.routes';
import catalogRoutes from './modules/catalog.routes';
import customersRoutes from './modules/customers.routes';
import walletRoutes from './modules/wallet.routes';
import ordersRoutes from './modules/orders.routes';
import trackingRoutes from './modules/tracking.routes';
import financeRoutes from './modules/finance.routes';
import reportsRoutes from './modules/reports.routes';
import staffRoutes from './modules/staff.routes';
import payrollRoutes from './modules/payroll.routes';
import dashboardRoutes from './modules/dashboard.routes';
import documentsRoutes from './modules/documents.routes';
import filesRoutes from './modules/files.routes';
import exportRoutes from './modules/export.routes';
import auditRoutes from './modules/audit.routes';
import cronRoutes from './modules/cron.routes';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    config: AppConfig;
    /** Uploaded files: local directory (Docker) or Supabase Storage (Vercel). */
    storage: FileStorage;
    /** Tenant-scoped Prisma client for the signed-in user's shop. */
    tdb: (req: FastifyRequest) => TenantDb;
  }
}

/** Mutations still allowed while a tenant is read-only (expired subscription). */
const READ_ONLY_ALLOW = [/^\/api\/auth\//];

export async function buildApp(prisma: PrismaClient, config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.isTest ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  app.decorate('prisma', prisma);
  app.decorate('config', config);
  app.decorate('storage', createStorage(config));
  app.decorate('tdb', (req: FastifyRequest) => scopedDb(prisma, requireTenant(req).tenant.id));
  app.decorateRequest('auth', null);

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'self'", 'blob:', 'data:'],
        workerSrc: ["'self'", 'blob:'],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, { global: false, allowList: config.isTest ? () => true : undefined });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 5 } });

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    req.auth = await loadAuth(prisma, req);
  });

  // CSRF protection: state-changing API calls must come from our own origin.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/') || req.method === 'GET' || req.method === 'HEAD') return;
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers['x-forwarded-host'] ?? req.headers.host;
      try {
        const o = new URL(origin);
        const allowed = new URL(config.publicUrl);
        if (o.host !== host && o.host !== allowed.host) {
          throw new AppError(403, 'BAD_ORIGIN', 'Cross-site request blocked');
        }
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError(403, 'BAD_ORIGIN', 'Cross-site request blocked');
      }
    }
  });

  // Expired subscriptions → read-only mode.
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/') || req.method === 'GET' || req.method === 'HEAD') return;
    const a = req.auth;
    if (!a?.tenant || a.supportMode) return;
    if (a.subscription?.readOnly && !READ_ONLY_ALLOW.some((r) => r.test(req.url))) {
      throw new AppError(402, 'READ_ONLY', 'Your subscription has expired. The account is read-only until it is renewed.');
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return reply.status(409).send({ error: { code: 'DUPLICATE', message: 'A record with the same value already exists' } });
      }
      if (err.code === 'P2025') {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
      }
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 429) {
      return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a minute and try again.' } });
    }
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: e.code ?? 'BAD_REQUEST', message: e.message } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
  });

  app.get('/api/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, time: new Date().toISOString() };
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(onboardingRoutes, { prefix: '/api/onboarding' });
  await app.register(platformRoutes, { prefix: '/api/platform' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });
  await app.register(usersRoutes, { prefix: '/api/users' });
  await app.register(catalogRoutes, { prefix: '/api/catalog' });
  await app.register(customersRoutes, { prefix: '/api/customers' });
  await app.register(walletRoutes, { prefix: '/api/wallet' });
  await app.register(ordersRoutes, { prefix: '/api/orders' });
  await app.register(trackingRoutes, { prefix: '/api/tracking' });
  await app.register(financeRoutes, { prefix: '/api/finance' });
  await app.register(reportsRoutes, { prefix: '/api/reports' });
  await app.register(staffRoutes, { prefix: '/api/staff' });
  await app.register(payrollRoutes, { prefix: '/api/payroll' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
  await app.register(documentsRoutes, { prefix: '/api/documents' });
  await app.register(filesRoutes, { prefix: '/api/files' });
  await app.register(exportRoutes, { prefix: '/api/export' });
  await app.register(auditRoutes, { prefix: '/api/audit' });
  await app.register(cronRoutes, { prefix: '/api/cron' });

  // Serve the built web app (single-page app) when available.
  if (config.webDist && fs.existsSync(config.webDist)) {
    const root = path.resolve(config.webDist);
    await app.register(fastifyStatic, {
      root,
      wildcard: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith('sw.js') || filePath.endsWith('index.html') || filePath.endsWith('.webmanifest')) {
          res.header('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.header('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    });
    app.get('/*', (req, reply) => {
      const rel = decodeURIComponent((req.params as { '*': string })['*'] ?? '');
      if (rel === 'api' || rel.startsWith('api/')) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` } });
      }
      const file = path.join(root, rel);
      if (rel && file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        return reply.sendFile(rel);
      }
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    });
  }

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` } });
  });

  app.addHook('onClose', async () => {
    await closePdf();
  });

  return app;
}
