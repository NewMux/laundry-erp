import type { FastifyInstance } from 'fastify';
import { formatMobile } from '@laundry/shared';
import { audit, requireTenant } from '../lib/context';
import { tablesToXlsx, type Table } from '../lib/excel';
import { AppError, forbidden } from '../lib/errors';
import { num } from '../lib/prisma';

/**
 * Full tenant data export (Excel) — every record of the shop in one workbook.
 * Owners only (or NewMux support with owner-granted access).
 */
export default async function exportRoutes(app: FastifyInstance) {
  app.get('/all', async (req, reply) => {
    const a = requireTenant(req);
    if (a.roleKey !== 'OWNER' && !a.supportMode) throw forbidden('Only the owner can export all data');
    if (a.features && !a.features.dataExport) throw new AppError(402, 'PLAN_FEATURE', 'Data export is not included in your plan');
    const db = app.tdb(req);
    const [customers, orders, items, payments, wallet, expenses, employees, attendance, payroll, prices, closings, packages, custPackages, auditLogs, users] =
      await Promise.all([
        db.customer.findMany({ orderBy: { createdAt: 'asc' } }),
        db.order.findMany({ where: { orderNo: { not: null } }, orderBy: { orderNo: 'asc' }, include: { customer: { select: { name: true } } } }),
        db.orderItem.findMany({ include: { order: { select: { orderNo: true } } } }),
        db.payment.findMany({ orderBy: { createdAt: 'asc' }, include: { order: { select: { orderNo: true } }, customer: { select: { name: true } } } }),
        db.walletTransaction.findMany({ orderBy: { createdAt: 'asc' }, include: { customer: { select: { name: true } } } }),
        db.expense.findMany({ orderBy: { date: 'asc' }, include: { category: { select: { name: true } } } }),
        db.employee.findMany({ orderBy: { name: 'asc' } }),
        db.attendance.findMany({ orderBy: { date: 'asc' }, include: { employee: { select: { name: true } } } }),
        db.payrollItem.findMany({ include: { payrollRun: true } }),
        db.priceListEntry.findMany({ include: { itemType: true, serviceType: true } }),
        db.cashClosing.findMany({ orderBy: { businessDate: 'asc' } }),
        db.package.findMany(),
        db.customerPackage.findMany({ include: { customer: { select: { name: true } } } }),
        db.auditLog.findMany({ orderBy: { createdAt: 'asc' }, take: 50000 }),
        db.user.findMany({ include: { role: true } }),
      ]);
    const iso = (d: Date | null | undefined) => (d ? d.toISOString() : '');
    const tables: Table[] = [
      {
        name: 'Customers',
        columns: ['name', 'mobile', 'altPhone', 'email', 'cpr', 'type', 'addrFlat', 'addrHouse', 'addrRoad', 'addrBlock', 'addrArea', 'addrBuilding', 'mapUrl', 'walletPaid', 'walletBonus', 'creditEnabled', 'creditLimit', 'notes', 'createdAt'].map((k) => ({
          key: k,
          header: k,
          type: ['walletPaid', 'walletBonus', 'creditLimit'].includes(k) ? 'money' : 'text',
        })),
        rows: customers.map((c) => ({ ...c, mobile: formatMobile(c.mobile), walletPaid: num(c.walletPaid), walletBonus: num(c.walletBonus), creditLimit: num(c.creditLimit), createdAt: iso(c.createdAt) })),
      },
      {
        name: 'Orders',
        columns: [
          { key: 'orderNo', header: 'Order #', type: 'number' },
          { key: 'businessDate', header: 'Date' },
          { key: 'customer', header: 'Customer' },
          { key: 'status', header: 'Status' },
          { key: 'express', header: 'Express' },
          { key: 'subtotal', header: 'Subtotal', type: 'money' },
          { key: 'expressSurcharge', header: 'Express surcharge', type: 'money' },
          { key: 'discountTotal', header: 'Discount', type: 'money' },
          { key: 'netAmount', header: 'Net', type: 'money' },
          { key: 'vatAmount', header: 'VAT', type: 'money' },
          { key: 'total', header: 'Total', type: 'money' },
          { key: 'paidAmount', header: 'Paid', type: 'money' },
          { key: 'balanceDue', header: 'Balance', type: 'money' },
          { key: 'onAccount', header: 'On account' },
          { key: 'pieceCount', header: 'Pieces', type: 'number' },
          { key: 'createdByName', header: 'Cashier' },
          { key: 'deliveredAt', header: 'Delivered' },
          { key: 'cancelReason', header: 'Cancel reason' },
        ],
        rows: orders.map((o) => ({ ...o, customer: o.customer?.name ?? '', deliveredAt: iso(o.deliveredAt) })),
      },
      {
        name: 'Order items',
        columns: [
          { key: 'orderNo', header: 'Order #', type: 'number' },
          { key: 'lineNo', header: 'Line', type: 'number' },
          { key: 'itemName', header: 'Item' },
          { key: 'serviceName', header: 'Service' },
          { key: 'quantity', header: 'Qty', type: 'number' },
          { key: 'area', header: 'Area m²', type: 'number' },
          { key: 'unitPrice', header: 'Unit price', type: 'money' },
          { key: 'discountAmount', header: 'Discount', type: 'money' },
          { key: 'lineTotal', header: 'Line total', type: 'money' },
          { key: 'color', header: 'Color' },
          { key: 'brand', header: 'Brand' },
          { key: 'damage', header: 'Damage' },
          { key: 'damageNotes', header: 'Damage notes' },
        ],
        rows: items.map((i) => ({ ...i, orderNo: i.order.orderNo })),
      },
      {
        name: 'Payments',
        columns: [
          { key: 'createdAt', header: 'Time' },
          { key: 'businessDate', header: 'Business date' },
          { key: 'kind', header: 'Type' },
          { key: 'method', header: 'Method' },
          { key: 'amount', header: 'Amount', type: 'money' },
          { key: 'revenueAmount', header: 'Revenue', type: 'money' },
          { key: 'vatPortion', header: 'VAT', type: 'money' },
          { key: 'walletPaidPortion', header: 'Wallet paid part', type: 'money' },
          { key: 'walletBonusPortion', header: 'Wallet bonus part', type: 'money' },
          { key: 'orderNo', header: 'Order #' },
          { key: 'customer', header: 'Customer' },
          { key: 'receiptNo', header: 'Receipt' },
          { key: 'createdByName', header: 'By' },
          { key: 'note', header: 'Note' },
        ],
        rows: payments.map((p) => ({ ...p, createdAt: iso(p.createdAt), orderNo: p.order?.orderNo ?? '', customer: p.customer?.name ?? '' })),
      },
      {
        name: 'Wallet',
        columns: [
          { key: 'createdAt', header: 'Time' },
          { key: 'customer', header: 'Customer' },
          { key: 'type', header: 'Type' },
          { key: 'paidDelta', header: 'Paid +/-', type: 'money' },
          { key: 'bonusDelta', header: 'Bonus +/-', type: 'money' },
          { key: 'paidAfter', header: 'Paid after', type: 'money' },
          { key: 'bonusAfter', header: 'Bonus after', type: 'money' },
          { key: 'reason', header: 'Reason' },
        ],
        rows: wallet.map((w) => ({ ...w, createdAt: iso(w.createdAt), customer: w.customer.name })),
      },
      {
        name: 'Packages',
        columns: [
          { key: 'customer', header: 'Customer' },
          { key: 'name', header: 'Package' },
          { key: 'kind', header: 'Kind' },
          { key: 'pricePaid', header: 'Price paid', type: 'money' },
          { key: 'totalItems', header: 'Items', type: 'number' },
          { key: 'remainingItems', header: 'Remaining', type: 'number' },
          { key: 'bonusRemaining', header: 'Bonus left', type: 'money' },
          { key: 'status', header: 'Status' },
          { key: 'expiresAt', header: 'Expires' },
        ],
        rows: custPackages.map((p) => ({ ...p, customer: p.customer.name, expiresAt: iso(p.expiresAt) })),
      },
      {
        name: 'Expenses',
        columns: [
          { key: 'date', header: 'Date' },
          { key: 'category', header: 'Category' },
          { key: 'amount', header: 'Amount', type: 'money' },
          { key: 'method', header: 'Method' },
          { key: 'vendor', header: 'Vendor' },
          { key: 'notes', header: 'Notes' },
        ],
        rows: expenses.map((e) => ({ ...e, category: e.category.name })),
      },
      {
        name: 'Cash closings',
        columns: ['businessDate', 'openingFloat', 'cashSales', 'cashTopups', 'cashRefunds', 'cashExpenses', 'expectedCash', 'countedCash', 'difference', 'reason', 'closedByName'].map((k) => ({
          key: k,
          header: k,
          type: ['businessDate', 'reason', 'closedByName'].includes(k) ? 'text' : 'money',
        })),
        rows: closings,
      },
      {
        name: 'Price list',
        columns: [
          { key: 'item', header: 'Item' },
          { key: 'service', header: 'Service' },
          { key: 'price', header: 'Price', type: 'money' },
          { key: 'expressPrice', header: 'Express price', type: 'money' },
          { key: 'isActive', header: 'Active' },
        ],
        rows: prices.map((p) => ({ item: p.itemType.name, service: p.serviceType.name, price: num(p.price), expressPrice: p.expressPrice === null ? null : num(p.expressPrice), isActive: p.isActive })),
      },
      {
        name: 'Package definitions',
        columns: ['name', 'kind', 'price', 'creditValue', 'itemCount', 'validityDays', 'isActive'].map((k) => ({ key: k, header: k })),
        rows: packages,
      },
      {
        name: 'Employees',
        columns: ['name', 'position', 'phone', 'nationality', 'cpr', 'cprExpiry', 'passportNo', 'passportExpiry', 'visaExpiry', 'joinDate', 'basicSalary', 'allowances', 'isActive'].map((k) => ({
          key: k,
          header: k,
          type: k === 'basicSalary' ? 'money' : 'text',
        })),
        rows: employees,
      },
      {
        name: 'Attendance',
        columns: [
          { key: 'date', header: 'Date' },
          { key: 'employee', header: 'Employee' },
          { key: 'status', header: 'Status' },
          { key: 'checkIn', header: 'In' },
          { key: 'checkOut', header: 'Out' },
          { key: 'source', header: 'Source' },
        ],
        rows: attendance.map((r) => ({ ...r, employee: r.employee.name, checkIn: iso(r.checkIn), checkOut: iso(r.checkOut) })),
      },
      {
        name: 'Payroll',
        columns: [
          { key: 'month', header: 'Month' },
          { key: 'employeeName', header: 'Employee' },
          { key: 'basic', header: 'Basic', type: 'money' },
          { key: 'allowances', header: 'Allowances', type: 'money' },
          { key: 'deductions', header: 'Deductions', type: 'money' },
          { key: 'advances', header: 'Advances', type: 'money' },
          { key: 'net', header: 'Net', type: 'money' },
          { key: 'status', header: 'Status' },
        ],
        rows: payroll.map((p) => ({ ...p, month: p.payrollRun.month, status: p.payrollRun.status })),
      },
      {
        name: 'Users',
        columns: ['name', 'username', 'email', 'role', 'isActive', 'lastLoginAt'].map((k) => ({ key: k, header: k })),
        rows: users.map((u) => ({ ...u, role: u.role?.name ?? '', lastLoginAt: iso(u.lastLoginAt) })),
      },
      {
        name: 'Audit log',
        columns: [
          { key: 'createdAt', header: 'Time' },
          { key: 'userName', header: 'User' },
          { key: 'action', header: 'Action' },
          { key: 'entity', header: 'Entity' },
          { key: 'entityId', header: 'Id' },
          { key: 'oldValue', header: 'Old value' },
          { key: 'newValue', header: 'New value' },
          { key: 'note', header: 'Note' },
        ],
        rows: auditLogs.map((l) => ({ ...l, createdAt: iso(l.createdAt) })),
      },
    ];
    await audit(db, req, 'data.exported', 'tenant', a.tenant.id, null, { sheets: tables.length });
    const buf = await tablesToXlsx(tables);
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${a.tenant.slug}-data-export-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    return buf;
  });
}
