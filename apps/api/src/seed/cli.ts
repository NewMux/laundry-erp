import { loadConfig } from '../config';
import { createPrisma } from '../lib/prisma';
import { DEMO_PASSWORD, seedDemo } from './demo';
import { ensurePlans, ensureSuperAdmin } from './tenant-setup';

/** `npm run db:seed` — plans, super admin and (with --demo) the demo shop. */
async function main() {
  const config = loadConfig();
  // Seeding uses interactive transactions: prefer the direct/session connection over a transaction pooler.
  const prisma = createPrisma(process.env.DIRECT_URL || undefined);
  await ensurePlans(prisma);
  const admin = await ensureSuperAdmin(prisma, config.superAdminEmail, config.superAdminPassword);
  console.log(admin ? `Super admin: ${admin.email}` : 'Super admin: set SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD to create one');
  if (process.argv.includes('--demo')) {
    const t = await seedDemo(prisma);
    console.log(
      t
        ? `Demo shop created. Shop code "demo"; users owner / manager / cashier / worker, password "${DEMO_PASSWORD}", PINs 1111 / 2222 / 3333 / 4444`
        : 'Demo shop already exists',
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
