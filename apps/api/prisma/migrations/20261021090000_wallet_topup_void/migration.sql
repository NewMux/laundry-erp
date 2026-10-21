-- AlterEnum
ALTER TYPE "WalletTxnType" ADD VALUE 'TOPUP_VOID';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "voidOfId" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_tenantId_idempotencyKey_key" ON "Payment"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_tenantId_voidOfId_key" ON "Payment"("tenantId", "voidOfId");
