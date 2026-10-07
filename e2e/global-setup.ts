import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createPrisma } from '../apps/api/src/lib/prisma';
import { seedDemo } from '../apps/api/src/seed/demo';

/** Seed a fresh demo shop for this run; tests read its shop code from .state.json. */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? 'postgresql://laundry:laundry@localhost:5432/laundry_e2e';
  execSync('npx prisma migrate deploy', { cwd: path.join(__dirname, '../apps/api'), env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: 'pipe' });
  const prisma = createPrisma(process.env.E2E_DATABASE_URL ?? 'postgresql://laundry:laundry@localhost:5432/laundry_e2e');
  const slug = `e2e${Date.now().toString(36)}`;
  await seedDemo(prisma, slug);
  await prisma.$disconnect();
  fs.writeFileSync(path.join(__dirname, '.state.json'), JSON.stringify({ slug }));
}
