import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface CatalogItem {
  id: string;
  name: string;
  imageKey: string | null;
  imageFileId: string | null;
  category: string | null;
  unit: 'PIECE' | 'SQM';
}
export interface CatalogService {
  id: string;
  name: string;
  iconKey: string | null;
  requiresProcessing: boolean;
  requiresIroning: boolean;
  turnaroundHours: number;
  expressTurnaroundHours: number;
}
export interface CatalogPrice {
  itemTypeId: string;
  serviceTypeId: string;
  price: number | null;
  expressPrice: number | null;
}
export interface PackageLine {
  itemTypeId: string | null;
  serviceTypeId: string | null;
  count: number;
}

/** The garments an item package covers: its lines, or the single garment on the package. */
export function packageLines(p: Pick<PackageDef, 'lines' | 'itemTypeId' | 'serviceTypeId' | 'itemCount'>): PackageLine[] {
  if (p.lines?.length) return p.lines;
  return [{ itemTypeId: p.itemTypeId, serviceTypeId: p.serviceTypeId, count: p.itemCount ?? 0 }];
}

export interface PackageDef {
  id: string;
  name: string;
  kind: 'CREDIT' | 'ITEMS';
  price: number;
  creditValue: number | null;
  itemCount: number | null;
  itemTypeId: string | null;
  serviceTypeId: string | null;
  /** Item packages covering several garments, e.g. 10 thobes + 10 shirts. */
  lines?: PackageLine[] | null;
  validityDays: number | null;
  description: string | null;
  isActive: boolean;
}

export interface PosCatalog {
  items: CatalogItem[];
  services: CatalogService[];
  prices: CatalogPrice[];
  packages: PackageDef[];
}

export function useCatalog() {
  return useQuery({ queryKey: ['catalog-pos'], queryFn: () => api.get<PosCatalog>('/api/catalog/pos'), staleTime: 5 * 60_000 });
}

export function priceIndex(c: PosCatalog | undefined) {
  const map = new Map<string, CatalogPrice>();
  for (const p of c?.prices ?? []) map.set(`${p.itemTypeId}:${p.serviceTypeId}`, p);
  return {
    get: (itemId: string, serviceId: string) => map.get(`${itemId}:${serviceId}`),
    unitPrice: (itemId: string, serviceId: string, express: boolean): number | null => {
      const p = map.get(`${itemId}:${serviceId}`);
      if (!p || p.price === null) return null;
      return express && p.expressPrice !== null ? p.expressPrice : p.price;
    },
    servicesFor: (itemId: string) => (c?.services ?? []).filter((s) => map.has(`${itemId}:${s.id}`)),
  };
}
