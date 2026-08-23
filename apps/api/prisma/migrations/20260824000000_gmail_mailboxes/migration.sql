CREATE TABLE "GmailMailbox" (
  "ownerEmail" TEXT NOT NULL,
  "gmailAddress" TEXT NOT NULL,
  "encryptedRefreshToken" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "GmailMailbox_pkey" PRIMARY KEY ("ownerEmail")
);

CREATE UNIQUE INDEX "GmailMailbox_gmailAddress_key" ON "GmailMailbox"("gmailAddress");
