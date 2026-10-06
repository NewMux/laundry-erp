# PRD coverage

Status of every requirement in *Laundry Management System — PRD (V1)*, with where it lives and what tests it. **Done** = implemented and exercised by an automated test or a browser check. **Setup** = implemented, but needs something at deploy time (a printer, a domain).

Test names refer to `apps/api/test/acceptance.test.ts` (**acc**), `apps/api/test/workflows.test.ts` (**wf**), `apps/api/test/serving.test.ts`, `packages/shared/test/shared.test.ts` (**unit**), and `e2e/acceptance.spec.ts` (**e2e**, real browser).

## §6 Acceptance criteria

| # | Criterion | Result | Verified by |
|---|---|---|---|
| AC1 | 7-item order from the picture grid, receipt and 7 tags, under 60 s | Done | acc *AC1*; e2e *AC1*: a cashier picks 7 garments by picture, pays cash, and the receipt plus a 7-tag sheet reach the printer in about 4 s |
| AC2 | Worker scans a tag on a phone, order moves to the next status | Done | acc *AC2* (also: single piece, no prices or phone numbers for workers); e2e *AC2* on an iPhone 13 viewport |
| AC3 | BHD 20 → 25 top-up, order paid from balance, receipt shows remaining balance | Done | acc *AC3* (20 paid + 5 bonus; item packages deduct items); e2e *AC3* (receipt shows 24.120 left after a 0.880 order) |
| AC4 | Credit customer gets a monthly statement PDF with invoices and payments | Done | acc *AC4* (asserts the response is a real PDF) |
| AC5 | Daily cash closing shows correct expected cash and locks the day | Done | acc *AC5* |
| AC6 | Payroll posts as a Salaries expense; payslip PDF prints | Done | acc *AC6 + AC7* |
| AC7 | Monthly P&L = recognised revenue − all expenses, including payroll | Done | acc *AC6 + AC7* |
| AC8 | Cashier cannot see reports or delete a paid invoice; the attempt is blocked | Done | acc *AC8* (also checks the audit log); e2e *AC8* |
| AC9 | Owner dashboard fully works on iPhone and Android | Done | e2e *AC9* on iPhone 13 and Pixel 7 viewports: all KPIs, chart, navigation, no horizontal scroll. Please also try it on real devices (see below). |
| AC10 | Two tenants cannot see each other's data | Done | acc *AC10* (customers, orders, scans, files, reports) |

The PRD says V1 is accepted when these pass **on a real laundry test account**. The demo shop (`npm run db:seed:demo -w @laundry/api`) is meant for exactly that session; real devices, the real printer and a real cashier are the remaining check.

## §2 Users and permissions

| Requirement | Status | Notes |
|---|---|---|
| Roles: Owner, Manager, Cashier, Worker + Super Admin | Done | `packages/shared/src/permissions.ts`; acc *Super admin and subscriptions* |
| Owner edits any role from a module × view/create/edit/delete/export matrix | Done | Settings → Roles. Gated by the plan's *advanced permissions* add-on (acc *plan user limit and the advanced-permissions add-on*) |
| Manager: no profit reports, no salary edits, no settings unless granted | Done | Default matrix; `finance_reports` module is separate from `reports` |
| Cashier: no deleting paid invoices, discount cap, no reports | Done | acc *AC8*; per-role `maxDiscountPercent` enforced on the server |
| Worker: no prices, no phone numbers, no finance | Done | Redacted by the API; acc *AC2* |
| Super admin has no tenant financial access unless support access is granted | Done | Time-limited grant by the shop; acc *Super admin and subscriptions* |
| Audit log with user, time, old and new value | Done | about 40 audited action types; Settings → Audit log; acc *AC8* |
| Login by email or username + password; optional 4-digit PIN switch | Done | acc *PIN switching on a shared counter device*; lockout after 5 failures |

## §3.1 Order intake (POS)

| Requirement | Status | Where / test |
|---|---|---|
| Search by phone first, create inline | Done | `CustomerBar` · e2e *AC1* (searches, finds, also creates when fast Enter is pressed) |
| Picture grid with images and names; service icons; tap adds, tap again increases | Done | 28 illustrations + owner photo upload; `apps/web/src/lib/illustrations.ts` · e2e *AC1* |
| Per item: service, quantity, colour, brand, notes; carpet per m² | Done | `LineDetailsModal` · acc *AC1* |
| Damage notes (stain, tear, missing button, faded) with camera photo, printed on receipt | Done | `DAMAGE_TYPES`, file upload · receipt renderer |
| Express toggle with fixed or % surcharge | Done | wf *uses express prices / surcharge and an earlier ready time* |
| Price list: item × service, normal and express prices, active flag, order, images | Done | Settings → Price list (changes audited) |
| Expected date from turnaround, override allowed | Done | `expectedReadyAt` with shop working hours · unit tests |
| Discounts per item/order, amount or %, role limit | Done | `calcOrder` · unit tests · audit |
| Payment: cash, card, BenefitPay, balance, credit, split | Done | `PaymentModal` · acc *AC3*, *AC4* |
| Unpaid / Partially paid / Paid | Done | `refreshPaymentState` |
| Park and resume; edit before processing | Done | wf *parks an order without a number…*, *edits an order before processing, not after* |

## §3.2 Printing

| Requirement | Status | Notes |
|---|---|---|
| 80mm receipt with all listed fields | Done | `renderReceiptHtml`; e2e *AC1*/*AC3* inspect the printed HTML |
| Item tags, 3/7 numbering, barcode, short name, service, express flag; label printers and 80mm cut mode | Done | `renderTagsHtml` (`LABEL` / `PAPER`); e2e *AC1* counts 7 tags |
| A4 tax invoice compliant with Bahrain VAT | Done | Seller VAT no., invoice no., date, VAT breakdown; PDF via Chromium |
| Top-up receipt, customer statement PDFs | Done | acc *AC3*, *AC4* |
| Reprint receipt, tag, invoice from history | Done | Order detail |
| Templates editable: logo, header, footer, terms, show/hide fields | Done | Settings → Printing, with a live preview |
| WhatsApp click-to-chat with PDF link | Done | `wa.me` links; signed public receipt PDF link |
| Direct printing to 80mm ESC/POS and label printers (E-POS ECO250) | **Setup** | Browser print with Chrome `--kiosk-printing`; see [DEPLOYMENT.md](DEPLOYMENT.md#counter-printing). Real printer test pending. |

## §3.3 Order tracking

| Requirement | Status | Where / test |
|---|---|---|
| Status flow Received → In process → Ironing → Ready → Delivered; Cancelled, On hold | Done | `packages/shared/src/status.ts` · unit tests · wf *holds block scanning…* |
| Scan tag barcode (USB scanner or phone camera), per order or per piece | Done | `useBarcodeScanner`, zxing `BarcodeCamera` · acc *AC2* |
| Kanban board and list with filters (date, status, express, overdue, unpaid) | Done | Board and Orders pages · wf *board moves clamp to each piece's own workflow* |
| Delivery: scan/search, balance due, collect payment, record who/when, partial pickup | Done | `DeliveryPage` · wf *delivery needs payment; partial pickup works* |
| Alerts: overdue, express, uncollected > X days (default 30) | Done | `computeAlerts` |
| WhatsApp "order ready" message | Done | Per-shop template |

## §3.4 Customers and prepaid balances

| Requirement | Status | Where / test |
|---|---|---|
| Profile: name, mobile (unique), alt phone, email, CPR, type, notes | Done | Mobile unique per tenant, normalised to `973XXXXXXXX` |
| Address fields stored, unused in V1 | Done | flat, house, building, road, block, area, map link |
| Order history, total spent, last visit, outstanding | Done | Customer detail |
| Wallet: top up cash/card/BenefitPay; deducted on orders; full movement log with reasons | Done | acc *AC3* · wf *refunds* |
| Packages: credit bonus and item-count, optional expiry | Done | acc *AC3* · wf *expires the unused bonus of an expired credit package* |
| Bonus credit tracked separately | Done | `walletPaid` / `walletBonus` |
| Credit customers: limit, monthly statement, payments against invoices | Done | acc *AC4* |
| Search, filter, export; bulk Excel import | Done | wf *imports customers from CSV, skipping duplicates and bad rows* |

## §3.5 Finance

| Requirement | Status | Where / test |
|---|---|---|
| Revenue from paid orders with payment method | Done | `Payment` ledger (see [ARCHITECTURE.md](ARCHITECTURE.md#accounting-rules-cash-basis-revenue)) |
| Top-ups are a liability, revenue when used | Done | acc *AC3*, *AC6 + AC7* |
| Expenses with category, method, vendor, notes, attachment, recurring | Done | wf *generates recurring expenses (e.g. monthly rent) up to today* |
| Daily cash closing, float, expected vs counted, reason, locked | Done | acc *AC5* |
| Reports: P&L, sales by day / item / service / payment / cashier, expenses by category, outstanding, customer balances, VAT, discounts and cancellations | Done | Each as screen, Excel, PDF; acc *AC6 + AC7* |

## §3.6 Staff

| Requirement | Status | Where / test |
|---|---|---|
| Employee profile, documents upload | Done | Employees pages |
| Expiry alerts at 30 and 7 days | Done | `expiryAlerts` (levels month / week / expired) |
| Attendance: system check-in/out, manager manual entry, monthly sheet | Done | Attendance page |
| Advances and deductions | Done | Advance creates a Salaries expense at payment |
| Payroll = basic + allowances − deductions − advances; paid → Salaries expense | Done | acc *AC6 + AC7* |
| Payslip PDF | Done | acc *AC6 + AC7* |
| Productivity: orders per cashier, items per worker (from scans) | Done | `productivity` report |
| Leave records with balance | Done | Annual, sick, unpaid; entitlement per shop or employee |

## §3.7 Owner dashboard

| Requirement | Status | Where / test |
|---|---|---|
| Today: orders, items, revenue, cash in drawer, expenses, ready-not-collected, overdue | Done | `dashboard.routes.ts` · e2e *AC9* |
| Month to date: revenue vs expenses vs profit trend, top items/services, new customers | Done | Cumulative MTD chart with table view |
| Fully usable on phone and tablet | Done | e2e *AC9*: iPhone 13, Pixel 7 |

## §4 SaaS and technical

| Requirement | Status | Notes |
|---|---|---|
| Strict tenant isolation | Done | Tenant-scoped Prisma extension; acc *AC10* |
| Self-onboarding: name, logo, CR, VAT, address, phone, hours, price-list template | Done | `/signup` · wf *signs up a new laundry on a trial with a starter price list* |
| Super admin: create/suspend, plan, dates, payment status, trial, user limits | Done | Admin page · acc *Super admin and subscriptions* |
| Plan limits enforced (users, add-ons) | Done | acc *enforces the plan user limit and the advanced-permissions add-on* |
| Read-only on expiry with renewal banner; data never deleted | Done | acc *expired subscription → read-only mode* |
| Responsive, touch-first POS, tuned for 1366×768 | Done | Browser-checked at 1366×768 and phone sizes |
| Installable PWA | Done | Manifest, icons, service worker |
| USB and camera barcode input | Done | Keyboard-burst hook; zxing |
| English only, all strings in a translation file, Arabic text accepted | Done | `en.json`; `npm run check:i18n` |
| Browser print or print agent | Done (browser) | See open questions |
| A4 PDFs server-side | Done | Chromium via playwright-core |
| HTTPS, hashed passwords, API-enforced RBAC, session timeout | Done | HTTPS terminates at Coolify/Caddy; see [ARCHITECTURE.md](ARCHITECTURE.md#authentication-and-authorisation) |
| Coolify on Hetzner; daily automated backups to Storage Box | Done (tested locally) | Dockerfile + compose; backup and restore verified against a local restic repository. The real Storage Box needs your credentials. |
| Asia/Bahrain dates; money in 3-decimal decimals | Done | Business dates are strings; `Decimal(12,3)` |
| Export all tenant data to Excel | Done | Owner only · wf *exports all shop data for the owner only* |

## §5 Out of scope: left ready

Pickup/delivery (address fields stored), Arabic UI (single translation file), WhatsApp/SMS API (click-to-chat templates), as described in [ARCHITECTURE.md](ARCHITECTURE.md#ready-for-later-phases). Multi-branch, supply inventory, a customer tracking page and loyalty points are not built, as specified.

## What this build could not verify

These need real hardware or accounts that were not available while building:

1. **A physical thermal printer.** Receipt and tag HTML are checked in the browser, and the print job is captured, but not printed on an E-POS ECO250 or a label printer. Printing the receipt with the paper set to 80mm and the tag sheet is a 5-minute test.
2. **Real iPhone and Android devices.** AC9 and AC2 pass in phone-sized browser emulation. iOS Safari ignores `--kiosk-printing`, so phones print through the system share sheet.
3. **The Hetzner Storage Box and Coolify.** The container builds, backups, and restores were exercised with local equivalents; the first run against your own Storage Box should be followed by a restore test, as described in [DEPLOYMENT.md](DEPLOYMENT.md#backups).
4. **The Docker image build itself.** The sandbox this was built in blocked the Debian package mirror, so `docker build` could not be completed here. The production dependencies, the bundled server, migrations, PDF rendering and static serving were each tested on the host the way the image runs them, and CI (`.github/workflows/ci.yml`) builds both images on every push.

## Open questions for Mohammed: recommendations

1. **Product name and domain.** Not decided in code; the app shows "NewMux Laundry" as a placeholder: `shell.productName` in `en.json`, plus `apps/web/index.html`, the PWA manifest and the Excel export's author. Renaming means editing those four places and the icons. Suggestion: pick a name that works in Arabic and English and put the app on a subdomain of the NewMux domain, e.g. `app.<name>.bh`, with each shop's sign-in using its short shop code.
2. **Reuse Tafsell's code, or a shared core?** The Tafsell code was not available here, so this is a clean build. The pieces that are product-agnostic are already separated and could be extracted into a shared core later: tenancy (`tenant-db`, plans, super admin, read-only mode, onboarding), auth/RBAC/audit, files, the report and Excel/PDF engine. The laundry-specific parts (orders, pieces, wallet, payroll) sit in their own modules. Recommendation: ship V1 as its own deployment, and extract the shared core once there are two products running on it, because designing it now would be speculation.
3. **Silent printing.** Recommendation: **browser printing with Chrome/Edge `--kiosk-printing`**, which is what V1 does. It is silent after one-time setup, needs nothing installed beyond the printer driver, and works on every Windows and macOS counter PC. Use 80mm paper tags so one printer does both. Add a small local print agent only if a shop needs a second, label-only printer to print silently at the same time as the receipt printer, or ESC/POS-only features such as the cash-drawer kick; the print HTML is already separate from the transport, so an agent can be added without changing the app.
4. **Timeline and cost.** V1 as specified is built and tested. The remaining time is acceptance on a real shop (a few days with a real printer and devices), deployment (about a day), and whatever changes the pilot shop asks for. Cost is yours to set; the main running costs are one Hetzner VM (PDF rendering runs Chromium on the same machine) and the Storage Box.
