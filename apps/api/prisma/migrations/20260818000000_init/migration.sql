CREATE TYPE "EmailStatus" AS ENUM ('SCHEDULED', 'SENDING', 'SENT', 'FAILED');
CREATE TABLE "EmailJob" (
  "id" TEXT NOT NULL, "ownerEmail" TEXT NOT NULL, "sender" TEXT NOT NULL, "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL, "body" TEXT NOT NULL, "hourlyLimit" INTEGER NOT NULL DEFAULT 100,
  "scheduledAt" TIMESTAMP(3) NOT NULL, "status" "EmailStatus" NOT NULL DEFAULT 'SCHEDULED',
  "attempts" INTEGER NOT NULL DEFAULT 0, "sentAt" TIMESTAMP(3), "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmailJob_status_scheduledAt_idx" ON "EmailJob"("status", "scheduledAt");
CREATE INDEX "EmailJob_sender_scheduledAt_idx" ON "EmailJob"("sender", "scheduledAt");
