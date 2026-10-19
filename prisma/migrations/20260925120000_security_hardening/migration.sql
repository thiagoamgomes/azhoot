-- Reforços de segurança (ver docs/security/auditoria-2026-09.md)

-- V4: exigir troca de senha após reset pelo master
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- V6: rastreabilidade/deduplicação de eventos de webhook
CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT,
    "paymentId" TEXT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "WebhookEvent"("provider", "eventId");
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");
