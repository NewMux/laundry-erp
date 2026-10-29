-- CreateTable
CREATE TABLE "AppPushToken" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppPushToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppPushToken_token_key" ON "AppPushToken"("token");

-- CreateIndex
CREATE INDEX "AppPushToken_appUserId_idx" ON "AppPushToken"("appUserId");

-- AddForeignKey
ALTER TABLE "AppPushToken" ADD CONSTRAINT "AppPushToken_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No Data API access (see 20261007060000_enable_row_level_security).
ALTER TABLE "AppPushToken" ENABLE ROW LEVEL SECURITY;
