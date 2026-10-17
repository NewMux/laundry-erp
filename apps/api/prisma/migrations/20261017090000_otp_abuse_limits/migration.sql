-- AlterTable
ALTER TABLE "OtpChallenge" ADD COLUMN "ipHash" TEXT;

-- CreateIndex
CREATE INDEX "OtpChallenge_ipHash_createdAt_idx" ON "OtpChallenge"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_createdAt_idx" ON "OtpChallenge"("createdAt");
