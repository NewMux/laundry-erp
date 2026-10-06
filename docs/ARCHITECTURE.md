# Architecture and accounting rules

## Overview

```
Browser (React PWA) ──/api──▶ Fastify API ──▶ PostgreSQL
        │                         │
        │                         └─▶ Chromium (HTML → PDF: invoice, statement, payslip, reports)
        └─ prints receipts / tags itself (iframe + window.print)
```

One Node process serves the API under `/api` and, in production, the built web app. `packages/shared` is plain TypeScript used by both sides, so the money maths, the permissions matrix, the status flow and the receipt/tag HTML are written once. The server and the browser can never disagree about a total.

## Multi-tenancy

- Every business table carries a `tenantId`. Users, roles, sessions, files and all records belong to exactly one tenant. Only `Plan` and the super admin are platform-level.
- All tenant queries go through `tenantDb(prisma, tenantId)` (`apps/api/src/lib/tenant-db.ts`), a Prisma client extension. It adds `tenantId` to every `where` and every `create`, for every model that has the column. The list of tenant models comes from the Prisma schema itself, so a new model cannot be forgotten.
- Raw SQL (reports) always filters on `"tenantId"` explicitly.
- Public links (receipt QR, statement PDF) use HMAC-signed tokens (`APP_SECRET`) that carry the tenant and document id.
- The super admin sees the platform (tenants, plans, counts) but **not** tenant data unless the shop grants a time-limited *support access* in its settings. The test suite checks cross-tenant reads for customers, orders, scans, files and reports.

## Authentication and authorisation

- Cookie sessions (`lms_sid`, HttpOnly, SameSite=Lax, Secure in production). Only the SHA-256 of the token is stored. Sessions expire after an idle timeout, which each shop sets (default 8 h).
- Passwords are bcrypt-hashed. Five failed sign-ins lock the account for 15 minutes. Login is rate limited.
- **PIN switch:** a trusted device (`lms_did` cookie, scoped to `/api/auth`) lists the shop's users and signs in with a 4-digit PIN. This is for the shared counter PC. Setting a PIN needs the password.
- State-changing requests must come from the app's own origin (Origin check), and a helmet CSP is applied.
- **RBAC is enforced on the API**, not in the UI. Roles are Owner, Manager, Cashier and Worker; permissions are a matrix of *module × view/create/edit/delete/export*, plus a few capabilities (view prices, view customer phone, discount limit per role, …). Owners can edit the matrix when their plan includes the *advanced permissions* add-on. Guards: `perm(module, action)`, `anyPerm(...)`, `requireTenant`, `requireSuperAdmin`. Blocked attempts at sensitive actions (reports, cancelling a paid invoice) are written to the audit log.
- **Audit log:** price changes, price overrides and discounts, order edits, cancellations and refunds, wallet adjustments and refunds, credit-limit changes, cash closing and reopening, expense edits and deletions, salary changes, advances and deductions, attendance corrections, payroll, permission and user changes, PIN changes, exports and blocked attempts.
- Workers get a redacted view of orders: no prices, payments, balances or customer phone numbers. The API removes these fields, so a worker cannot see them even by opening the network tab.

## Plans and subscriptions

`Plan` defines the user limit and add-ons (`customPermissions`, `dataExport`). A tenant has a status (`ACTIVE`, `SUSPENDED`), `trialEndsAt`, `currentPeriodEnd` and a payment status, all managed by the super admin. Creating a user beyond the seat limit is refused. When the subscription expires, every non-GET request except sign-in returns `402 READ_ONLY` and the UI shows a renewal banner. Data is never deleted. A suspended tenant cannot sign in.

## Orders

- **Invoice number.** The order number *is* the VAT tax invoice number: sequential per tenant, allocated atomically (`UPDATE … RETURNING`), starting at 1001. Parked orders (`DRAFT`) have no number until they are received, so numbering has no gaps.
- **Pieces.** An order line (e.g. 3 thobes) expands into one `OrderPiece` per physical garment. A tag, barcode and scan refer to a piece (`1042-3`); the receipt's barcode refers to the order (`O1042`).
- **Status flow.** `RECEIVED → IN_PROCESS → IRONING → READY → DELIVERED`. Each service defines which steps it needs (`requiresProcessing`, `requiresIroning`), so "Ironing only" skips washing. Scans and the board move a *piece*; the order's status is that of its least advanced piece. A "hold" blocks scanning (e.g. waiting for the customer).
- **Delivery.** Partial pickup is supported (deliver the pieces that are ready). Delivery can require payment first (setting).
- **Express.** A per-item express price, or a percent / fixed surcharge, plus an earlier expected-ready time computed from the shop's working hours.
- **Editing.** An order can be edited until processing starts; cancelling an order needs the cancel permission and a reason, and the refund goes to the original method, cash or the wallet.
- **Dates.** `businessDate` is a `YYYY-MM-DD` string in Asia/Bahrain time, so reports and the cash closing never depend on the server's time zone.

## Money

- BHD with 3 decimals (fils). The database stores `Decimal(12,3)`. All arithmetic is done in integer fils (`calcOrder`, `splitWalletUse`, `vatShare`) and converted back, so there is no floating-point drift. API JSON returns numbers.
- VAT is a per-tenant setting (default 10%), applied on the price list as *added on top* or *included*. Express surcharge and discounts are applied before VAT. Discount limits are enforced per role on the server.

## Accounting rules (cash-basis revenue)

These decisions drive every report. They were chosen so that **P&L = recognised revenue − all expenses** (AC7) and the cash closing reconciles to the till (AC5).

1. **Revenue is recognised when an order is paid**, not when it is created. Each `Payment` row records `revenueAmount` and `vatPortion` for that payment; unpaid orders and credit sales are *not* revenue until the customer pays.
2. **Top-ups and package sales are liabilities, not revenue.** Money received for a BHD 20 → 25 package increases the customer's balance (`walletPaid` 20, `walletBonus` 5) and the "customer balances" liability report. It becomes revenue only when the customer spends it.
3. **Spending the wallet** recognises revenue. Each spend is split proportionally between paid credit and bonus credit. Only the paid share is revenue; **bonus credit used is never revenue** (it's shown as a memo column in the P&L). VAT inside a wallet spend is calculated on the paid share.
4. **Item-count packages** (e.g. 10 shirts): the order line is priced 0 and a `PACKAGE_REDEMPTION` payment recognises the revenue, VAT included, when the items are used.
5. **Credit accounts.** An order "on account" has no payment, so no revenue yet. A later payment is allocated to the invoices the cashier selects, oldest first; revenue is recognised then. The statement PDF lists invoices, payments and a running balance.
6. **Refunds and cancellations** write negative payment rows: the original revenue is reversed on the day of the refund. Refunding to the wallet returns exactly the paid and bonus credit that was used. A cash refund of top-up credit pays out paid credit only; **bonus is never refunded in cash**.
7. **Expenses** are recognised on their date. Recurring expenses (rent, internet) are generated by an hourly job up to today, and the monthly anchor day is respected (e.g. the 31st in short months). Salary **advances** are expensed when paid out; **payroll** posts net pay (basic + allowances − deductions − advances − unpaid leave) as *Salaries* expenses, so an advance is never counted twice.
8. **VAT report** is based on **invoices issued** in the period (order `netAmount` and `vatAmount`, cancelled ones excluded), plus VAT recognised on package redemptions. It can therefore differ from the cash-basis P&L in a month where invoices were paid later; both are correct for their purpose.
9. **Daily cash closing.** Expected cash = opening float + cash sales + cash top-ups and package sales − cash refunds − cash expenses for the business day (card, BenefitPay and balance payments are listed separately). The cashier enters the counted cash; the difference and a reason are stored and the day is **locked**: expenses, advances and payroll payments dated on a closed day are rejected (`DAY_CLOSED`), and any payment taken after the close is booked on the next open business day. Only the owner can reopen a day, and the reopening is audited.

## Reports

Twelve report definitions share one result model (KPIs + tables) and render as JSON (screen), Excel and PDF from the same data: profit & loss, sales by day / item type / service / payment method / cashier, expenses by category, outstanding credit and unpaid orders, customer balances (liability), VAT, discounts and cancellations, and staff productivity. Each report is guarded by its module permission. The owner can also export **all** shop data to one Excel workbook (owner only, plan add-on).

## Printing

Receipt (80mm), tags, and top-up receipt are generated as HTML by the shared renderers and printed from the browser through a hidden iframe: fully silent with Chrome/Edge `--kiosk-printing` (see [DEPLOYMENT.md](DEPLOYMENT.md)). The same HTML is rendered to PDF on the server for the public receipt link. The tax invoice (A4), statements, payslips and report PDFs are rendered by Chromium on the server (`apps/api/src/pdf`), at most three at a time. WhatsApp messages are `wa.me` click-to-chat links filled from per-shop templates; V1 sends nothing automatically.

The barcode library (bwip-js, ~900 kB) lives in `@laundry/shared/print` and is only loaded when something is printed, so it stays out of the main web bundle.

## Web app

React 19, Vite, Tailwind 4, react-router, TanStack Query. Every route is lazy-loaded. A manual service worker and manifest make it installable (PWA); API calls are never cached. USB barcode scanners are handled as fast keyboard bursts; the camera scanner (zxing) loads only on the scan page. Every string comes from `en.json` through i18next (`npm run check:i18n` fails the build if a key is missing), so a second language is a translation file, not a refactor. Customer names and notes accept Arabic text and are rendered with `bidi` isolation. The server uses the same `en.json` for PDFs and report headings.

## Data model (Prisma)

`Plan`, `Tenant`, `Role`, `User`, `Session`, `Device`, `AuditLog`, `FileObject` · `ItemType`, `ServiceType`, `PriceListEntry` · `Customer`, `WalletTransaction`, `Package`, `CustomerPackage` · `Order`, `OrderItem`, `OrderPiece`, `OrderEvent`, `Payment`, `CashClosing` · `ExpenseCategory`, `Expense`, `RecurringExpense` · `Employee`, `EmployeeDocument`, `Attendance`, `EmployeeAdjustment`, `PayrollRun`, `PayrollItem`, `LeaveRecord`.

## Ready for later phases

- **Pickup and delivery / driver app:** customers already store address fields (flat, house, building, road, block, area, map link). Orders have a delivery step; a driver role and route model can be added without changing existing tables.
- **Arabic UI:** add `ar.json` next to `en.json` and a language switch; no code refactor.
- **WhatsApp / SMS API:** the click-to-chat templates (`whatsapp` settings, `fillTemplate`) are the same messages an API integration would send.
- **Multi-branch (not planned):** would add a `branchId` to orders, payments and cash closings.
