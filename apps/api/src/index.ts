import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { loadConfig } from './config';
import { scheduleJobs } from './jobs';
import { createPrisma } from './lib/prisma';
import { ensurePlans, ensureSuperAdmin } from './seed/tenant-setup';

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const defaultWeb = [path.resolve(here, '../../web/dist'), path.resolve(here, '../web')].find((p) => fs.existsSync(p));
  const config = loadConfig({ webDist: process.env.WEB_DIST || defaultWeb });
  const prisma = createPrisma();
  await ensurePlans(prisma);
  await ensureSuperAdmin(prisma, config.superAdminEmail, config.superAdminPassword);
  const app = await buildApp(prisma, config);
  const timer = scheduleJobs(prisma, app.log);
  const close = async () => {
    clearInterval(timer);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
