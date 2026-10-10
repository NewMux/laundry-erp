-- Customer app: customer accounts and sign-in codes, saved addresses, pickup &
-- delivery on orders (source, legs, slots, driver fee), Arabic names and the
-- shop's customer code. Additive only: existing rows keep working unchanged
-- (every order defaults to COUNTER, drop-off, collect, no driver fee).

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('COUNTER', 'APP');

-- CreateEnum
CREATE TYPE "Inbound" AS ENUM ('DROPOFF', 'PICKUP');

-- CreateEnum
CREATE TYPE "Outbound" AS ENUM ('COLLECT', 'DELIVERY');

-- CreateEnum
CREATE TYPE "HandoverStatus" AS ENUM ('AWAITING_DROPOFF', 'AWAITING_PICKUP', 'PICKUP_EN_ROUTE', 'OUT_FOR_DELIVERY');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "appUserId" TEXT;

-- AlterTable
ALTER TABLE "ItemType" ADD COLUMN     "nameAr" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "address" JSONB,
ADD COLUMN     "addressId" TEXT,
ADD COLUMN     "appIdempotencyKey" TEXT,
ADD COLUMN     "appPaymentMethod" "PaymentMethod",
ADD COLUMN     "appRef" TEXT,
ADD COLUMN     "deliverySlot" JSONB,
ADD COLUMN     "driverFee" DECIMAL(12,3) NOT NULL DEFAULT 0,
ADD COLUMN     "handoverStatus" "HandoverStatus",
ADD COLUMN     "inbound" "Inbound" NOT NULL DEFAULT 'DROPOFF',
ADD COLUMN     "outbound" "Outbound" NOT NULL DEFAULT 'COLLECT',
ADD COLUMN     "pickupSlot" JSONB,
ADD COLUMN     "source" "OrderSource" NOT NULL DEFAULT 'COUNTER';

-- AlterTable
ALTER TABLE "ServiceType" ADD COLUMN     "nameAr" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "customerCode" TEXT,
ADD COLUMN     "nameAr" TEXT;

-- CreateTable
CREATE TABLE "AppUser" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "block" TEXT NOT NULL,
    "road" TEXT NOT NULL,
    "building" TEXT NOT NULL,
    "flat" TEXT,
    "notes" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_phone_key" ON "AppUser"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "AppSession_tokenHash_key" ON "AppSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AppSession_appUserId_idx" ON "AppSession"("appUserId");

-- CreateIndex
CREATE INDEX "OtpChallenge_phone_createdAt_idx" ON "OtpChallenge"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerAddress_tenantId_customerId_idx" ON "CustomerAddress"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "Customer_appUserId_idx" ON "Customer"("appUserId");

-- CreateIndex
CREATE INDEX "Order_tenantId_source_status_idx" ON "Order"("tenantId", "source", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_appRef_key" ON "Order"("tenantId", "appRef");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_appIdempotencyKey_key" ON "Order"("tenantId", "appIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_customerCode_key" ON "Tenant"("customerCode");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSession" ADD CONSTRAINT "AppSession_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Same rule as every other table (see 20261007060000_enable_row_level_security).
ALTER TABLE "AppUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OtpChallenge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerAddress" ENABLE ROW LEVEL SECURITY;
