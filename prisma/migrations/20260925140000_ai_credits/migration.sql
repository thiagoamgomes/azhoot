-- Créditos de IA e geração de perguntas (ver docs/security e roadmap)

ALTER TABLE "Plan" ADD COLUMN "aiCreditsIncluded" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Account" ADD COLUMN "aiCreditsBalance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'SUBSCRIPTION';
ALTER TABLE "Payment" ADD COLUMN "creditPackId" UUID;
ALTER TABLE "Payment" ADD COLUMN "creditsGranted" INTEGER;

CREATE TABLE "CreditPack" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "CreditPack_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CreditPack_active_sortOrder_idx" ON "CreditPack"("active", "sortOrder");

CREATE TABLE "CreditTransaction" (
    "id" UUID NOT NULL,
    "accountId" UUID,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refKey" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CreditTransaction_reason_refKey_key" ON "CreditTransaction"("reason", "refKey");
CREATE INDEX "CreditTransaction_accountId_createdAt_idx" ON "CreditTransaction"("accountId", "createdAt");
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiGeneration" (
    "id" UUID NOT NULL,
    "accountId" UUID,
    "userId" UUID,
    "theme" TEXT NOT NULL,
    "level" TEXT,
    "questionType" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "model" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT "AiGeneration_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiGeneration_accountId_createdAt_idx" ON "AiGeneration"("accountId", "createdAt");
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Pacotes padrão (preços editáveis no painel master)
INSERT INTO "CreditPack" ("id","name","credits","priceCents","active","sortOrder","updatedAt") VALUES
  (gen_random_uuid(), '5 créditos',   5,   1990, true, 0, now()),
  (gen_random_uuid(), '10 créditos',  10,  3490, true, 1, now()),
  (gen_random_uuid(), '50 créditos',  50,  14900, true, 2, now()),
  (gen_random_uuid(), '100 créditos', 100, 24900, true, 3, now()),
  (gen_random_uuid(), '500 créditos', 500, 99900, true, 4, now());

-- Créditos grátis padrão por plano (editáveis)
UPDATE "Plan" SET "aiCreditsIncluded" = 3  WHERE "id" = 'FREE';
UPDATE "Plan" SET "aiCreditsIncluded" = 20 WHERE "id" = 'MONTHLY';
UPDATE "Plan" SET "aiCreditsIncluded" = 100 WHERE "id" = 'YEARLY';
