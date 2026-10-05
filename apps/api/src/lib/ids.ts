import crypto from 'node:crypto';

export function cryptoId(): string {
  return crypto.randomUUID();
}
