import type { ItemUnit, PaymentMethod } from '../enums';

export interface PrintShop {
  name: string;
  address?: string | null;
  phone?: string | null;
  vatNumber?: string | null;
  crNumber?: string | null;
  logoUrl?: string | null;
}

export interface PrintOrderItem {
  lineNo: number;
  itemName: string;
  serviceName: string;
  unit: ItemUnit;
  quantity: number;
  area?: number | null;
  unitPrice: number;
  discountAmount: number;
  lineTotal: number;
  color?: string | null;
  brand?: string | null;
  notes?: string | null;
  damage: string[];
  damageNotes?: string | null;
  coveredByPackage?: boolean;
}

export interface PrintPiece {
  pieceNo: number;
  itemName: string;
  serviceName: string;
  color?: string | null;
}

export interface PrintOrder {
  orderNo: number;
  createdAt: string;
  expectedAt?: string | null;
  express: boolean;
  cashierName?: string | null;
  customer?: { name: string; mobile?: string | null } | null;
  items: PrintOrderItem[];
  pieces: PrintPiece[];
  subtotal: number;
  discountTotal: number;
  expressSurcharge: number;
  vatRate: number;
  vatAmount: number;
  netAmount: number;
  total: number;
  paidAmount: number;
  balanceDue: number;
  onAccount: boolean;
  payments: { method: PaymentMethod; amount: number }[];
  /** Customer prepaid balance after this order (paid + bonus). */
  walletBalance?: number | null;
  notes?: string | null;
  /** Link encoded in the receipt QR (public receipt page). */
  qrLink?: string | null;
  status?: string;
}

export interface PrintTopup {
  receiptNo: string;
  createdAt: string;
  cashierName?: string | null;
  customer: { name: string; mobile?: string | null };
  description: string;
  method: PaymentMethod;
  amountPaid: number;
  creditAdded: number;
  bonusAdded: number;
  balanceAfter: number;
  itemsLine?: string | null;
}
