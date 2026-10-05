import type { OrderStatus, PieceStatus } from './enums';

/** Rank of each piece status in the workflow. */
export const PIECE_RANK: Record<PieceStatus, number> = {
  RECEIVED: 0,
  IN_PROCESS: 1,
  IRONING: 2,
  READY: 3,
  DELIVERED: 4,
};

export interface ServiceSteps {
  requiresProcessing: boolean; // washing / dry cleaning / dyeing step
  requiresIroning: boolean;
}

/** Workflow steps a piece passes through for a given service, excluding delivery. */
export function stepsFor(service: ServiceSteps): PieceStatus[] {
  const steps: PieceStatus[] = ['RECEIVED'];
  if (service.requiresProcessing) steps.push('IN_PROCESS');
  if (service.requiresIroning) steps.push('IRONING');
  steps.push('READY');
  return steps;
}

/** Next workflow status for a piece, or null if it is ready/delivered. */
export function nextPieceStatus(current: PieceStatus, service: ServiceSteps): PieceStatus | null {
  if (current === 'READY' || current === 'DELIVERED') return null;
  const steps = stepsFor(service);
  const rank = PIECE_RANK[current];
  return steps.find((s) => PIECE_RANK[s] > rank) ?? 'READY';
}

/** Previous workflow status for a piece (undo a scan), or null. */
export function prevPieceStatus(current: PieceStatus, service: ServiceSteps): PieceStatus | null {
  if (current === 'RECEIVED' || current === 'DELIVERED') return null;
  const steps = stepsFor(service);
  const rank = PIECE_RANK[current];
  const before = steps.filter((s) => PIECE_RANK[s] < rank);
  return before[before.length - 1] ?? 'RECEIVED';
}

/**
 * Order status derived from its pieces: the least advanced piece that has not
 * been delivered. All delivered → DELIVERED.
 */
export function orderStatusFromPieces(pieces: { status: PieceStatus }[]): OrderStatus {
  if (pieces.length === 0) return 'RECEIVED';
  const open = pieces.filter((p) => p.status !== 'DELIVERED');
  if (open.length === 0) return 'DELIVERED';
  let min: PieceStatus = 'READY';
  for (const p of open) if (PIECE_RANK[p.status] < PIECE_RANK[min]) min = p.status;
  return min;
}

export function isActiveOrderStatus(s: OrderStatus): boolean {
  return s === 'RECEIVED' || s === 'IN_PROCESS' || s === 'IRONING' || s === 'READY';
}
