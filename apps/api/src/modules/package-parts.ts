import type { Package } from '@prisma/client';
import { fromFils, toFils } from '@laundry/shared';
import { num } from '../lib/prisma';
import type { TenantDb, TenantTx } from '../lib/tenant-db';

type Q = TenantDb | TenantTx;

export interface GarmentLine {
  itemTypeId: string | null;
  serviceTypeId: string | null;
  count: number;
}

export interface PackagePart extends GarmentLine {
  /** Name of the customer's package: the package name, plus the garment when it covers several. */
  name: string;
  /** e.g. "Thobe · Wash & Iron" */
  label: string;
  /** This part's share of the price, for recognising revenue as pieces are used. */
  price: number;
}

/** The garments an item package covers: its `lines`, or the single garment on the package itself. */
export function packageLines(pkg: Pick<Package, 'lines' | 'itemTypeId' | 'serviceTypeId' | 'itemCount'>): GarmentLine[] {
  const lines = Array.isArray(pkg.lines) ? (pkg.lines as unknown as GarmentLine[]) : [];
  if (lines.length) return lines.map((l) => ({ itemTypeId: l.itemTypeId ?? null, serviceTypeId: l.serviceTypeId ?? null, count: Number(l.count) }));
  return [{ itemTypeId: pkg.itemTypeId, serviceTypeId: pkg.serviceTypeId, count: pkg.itemCount ?? 0 }];
}

/** "Thobe · Wash & Iron", "Shirt", "Any item · Ironing" */
export async function garmentLabels(db: Q, lines: GarmentLine[]): Promise<string[]> {
  const itemIds = lines.map((l) => l.itemTypeId).filter((x): x is string => !!x);
  const serviceIds = lines.map((l) => l.serviceTypeId).filter((x): x is string => !!x);
  const [items, services] = await Promise.all([
    itemIds.length ? db.itemType.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } }) : [],
    serviceIds.length ? db.serviceType.findMany({ where: { id: { in: serviceIds } }, select: { id: true, name: true } }) : [],
  ]);
  const item = new Map(items.map((i) => [i.id, i.name]));
  const service = new Map(services.map((s) => [s.id, s.name]));
  return lines.map((l) => {
    const name = (l.itemTypeId && item.get(l.itemTypeId)) || 'Any item';
    const svc = l.serviceTypeId && service.get(l.serviceTypeId);
    return svc ? `${name} · ${svc}` : name;
  });
}

/**
 * Split an item package into one part per garment. The price is shared in proportion to what the
 * pieces would cost at the regular price, or by count when a line has no single regular price
 * (any item, or any service). Rounding goes to the last part so the parts add up to the price.
 */
export async function itemPackageParts(db: Q, pkg: Package): Promise<PackagePart[]> {
  const lines = packageLines(pkg);
  const total = toFils(num(pkg.price));
  if (lines.length === 1) {
    const [label] = await garmentLabels(db, lines);
    return [{ ...lines[0]!, name: pkg.name, label: label!, price: num(pkg.price) }];
  }
  const labels = await garmentLabels(db, lines);
  const keyed = lines.filter((l) => l.itemTypeId && l.serviceTypeId);
  const prices =
    keyed.length === lines.length
      ? await db.priceListEntry.findMany({ where: { OR: keyed.map((l) => ({ itemTypeId: l.itemTypeId!, serviceTypeId: l.serviceTypeId! })) } })
      : [];
  const unit = (l: GarmentLine) => prices.find((p) => p.itemTypeId === l.itemTypeId && p.serviceTypeId === l.serviceTypeId);
  const byPrice = prices.length === lines.length && lines.every((l) => toFils(num(unit(l)!.price)) > 0);
  const weights = lines.map((l) => l.count * (byPrice ? toFils(num(unit(l)!.price)) : 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  let given = 0;
  return lines.map((l, i) => {
    const share = i === lines.length - 1 ? total - given : Math.floor((total * weights[i]!) / sum);
    given += share;
    return { ...l, name: `${pkg.name} — ${labels[i]}`, label: labels[i]!, price: fromFils(share) };
  });
}

/** Receipt line: "30 items", or "10 × Thobe, 10 × Shirt" for a package covering several garments. */
export function itemsSummary(parts: { count: number; label: string }[]): string {
  if (parts.length === 1) return `${parts[0]!.count} items`;
  return parts.map((p) => `${p.count} × ${p.label}`).join(', ');
}
