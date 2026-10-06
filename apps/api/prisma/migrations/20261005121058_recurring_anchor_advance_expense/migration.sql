-- AlterTable
ALTER TABLE "EmployeeAdjustment" ADD COLUMN     "expenseId" TEXT;

-- AlterTable
ALTER TABLE "RecurringExpense" ADD COLUMN     "anchorDay" INTEGER NOT NULL DEFAULT 1;
