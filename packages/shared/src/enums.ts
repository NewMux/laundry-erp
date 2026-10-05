// Domain enums shared by the API and the web app.
// Keep these in sync with the Prisma schema enums of the same name.

export const ORDER_STATUSES = [
  'DRAFT',
  'RECEIVED',
  'IN_PROCESS',
  'IRONING',
  'READY',
  'DELIVERED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Status of a single physical piece (one tag). */
export const PIECE_STATUSES = ['RECEIVED', 'IN_PROCESS', 'IRONING', 'READY', 'DELIVERED'] as const;
export type PieceStatus = (typeof PIECE_STATUSES)[number];

/** Board columns, in workflow order. */
export const BOARD_STATUSES = ['RECEIVED', 'IN_PROCESS', 'IRONING', 'READY'] as const;

export const PAYMENT_STATES = ['UNPAID', 'PARTIAL', 'PAID'] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/** Methods a customer can pay with at the counter. */
export const PAYMENT_METHODS = ['CASH', 'CARD', 'BENEFIT_PAY', 'WALLET', 'PACKAGE', 'BANK_TRANSFER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Methods allowed for collecting money (top-ups, settlements, expenses). */
export const MONEY_IN_METHODS = ['CASH', 'CARD', 'BENEFIT_PAY', 'BANK_TRANSFER'] as const;
export type MoneyInMethod = (typeof MONEY_IN_METHODS)[number];

export const PAYMENT_KINDS = ['ORDER', 'TOPUP', 'PACKAGE_SALE', 'REFUND', 'WALLET_REFUND', 'PACKAGE_REDEMPTION'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const WALLET_TXN_TYPES = ['TOPUP', 'PACKAGE', 'ORDER_PAYMENT', 'ORDER_REFUND', 'REFUND', 'ADJUSTMENT', 'EXPIRY'] as const;
export type WalletTxnType = (typeof WALLET_TXN_TYPES)[number];

export const CUSTOMER_TYPES = ['INDIVIDUAL', 'COMPANY'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const ITEM_UNITS = ['PIECE', 'SQM'] as const;
export type ItemUnit = (typeof ITEM_UNITS)[number];

export const DISCOUNT_TYPES = ['AMOUNT', 'PERCENT'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const DAMAGE_TYPES = ['STAIN', 'TEAR', 'MISSING_BUTTON', 'FADED', 'BURN', 'SHRINK', 'OTHER'] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export const PACKAGE_KINDS = ['CREDIT', 'ITEMS'] as const;
export type PackageKind = (typeof PACKAGE_KINDS)[number];

export const TENANT_STATUSES = ['TRIAL', 'ACTIVE', 'SUSPENDED'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const SUBSCRIPTION_PAYMENT_STATUSES = ['PAID', 'UNPAID', 'OVERDUE'] as const;
export type SubscriptionPaymentStatus = (typeof SUBSCRIPTION_PAYMENT_STATUSES)[number];

export const LEAVE_TYPES = ['ANNUAL', 'SICK', 'UNPAID'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const ADJUSTMENT_TYPES = ['ADVANCE', 'DEDUCTION'] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

export const DOCUMENT_TYPES = ['CPR', 'PASSPORT', 'VISA', 'CONTRACT', 'OTHER'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const RECURRING_FREQUENCIES = ['WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export const ROLE_KEYS = ['OWNER', 'MANAGER', 'CASHIER', 'WORKER'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity & Water',
  'Detergents & Supplies',
  'Salaries',
  'Maintenance',
  'Marketing',
  'Government Fees',
  'Other',
] as const;

export const SALARIES_CATEGORY = 'Salaries';
