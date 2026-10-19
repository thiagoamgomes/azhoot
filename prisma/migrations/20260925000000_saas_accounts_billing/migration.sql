-- CreateEnum
CREATE TYPE "PlanInterval" AS ENUM ('NONE', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'FROZEN');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'RECEIVED', 'OVERDUE', 'CANCELED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'PAID', 'CANCELED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('MARKETING', 'INFRA', 'PESSOAL', 'IMPOSTOS', 'FERRAMENTAS', 'OUTROS');

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "interval" "PlanInterval" NOT NULL DEFAULT 'NONE',
    "maxQuizzes" INTEGER,
    "maxParticipants" INTEGER NOT NULL,
    "maxUsers" INTEGER NOT NULL,
    "features" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "planId" TEXT NOT NULL DEFAULT 'FREE',
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "billingExempt" BOOLEAN NOT NULL DEFAULT false,
    "currentPeriodStart" TIMESTAMPTZ(3),
    "currentPeriodEnd" TIMESTAMPTZ(3),
    "pendingPlanId" TEXT,
    "pendingChangeAt" TIMESTAMPTZ(3),
    "pendingRemovals" JSONB NOT NULL DEFAULT '{}',
    "frozenAt" TIMESTAMPTZ(3),
    "firstPaidAt" TIMESTAMPTZ(3),
    "canceledAt" TIMESTAMPTZ(3),
    "overrideMaxQuizzes" INTEGER,
    "overrideUnlimitedQuizzes" BOOLEAN NOT NULL DEFAULT false,
    "overrideMaxParticipants" INTEGER,
    "overrideMaxUsers" INTEGER,
    "overridePriceCents" INTEGER,
    "billingName" TEXT,
    "billingDocument" TEXT,
    "billingEmail" TEXT,
    "billingPhone" TEXT,
    "asaasCustomerId" TEXT,
    "asaasSubscriptionId" TEXT,
    "affiliateEnabled" BOOLEAN NOT NULL DEFAULT false,
    "affiliateCode" TEXT,
    "affiliatePercentBp" INTEGER,
    "pixKeyType" TEXT,
    "pixKey" TEXT,
    "referredByAccountId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "accountId" UUID,
    "accountName" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "netAmountCents" INTEGER,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "billingType" TEXT,
    "description" TEXT,
    "dueDate" TIMESTAMPTZ(3) NOT NULL,
    "paidAt" TIMESTAMPTZ(3),
    "periodStart" TIMESTAMPTZ(3),
    "periodEnd" TIMESTAMPTZ(3),
    "invoiceUrl" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'asaas',
    "providerId" TEXT,
    "providerSubscriptionId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionEvent" (
    "id" BIGSERIAL NOT NULL,
    "accountId" UUID,
    "type" TEXT NOT NULL,
    "fromPlanId" TEXT,
    "toPlanId" TEXT,
    "mrrDeltaCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" UUID NOT NULL,
    "affiliateAccountId" UUID,
    "referredAccountId" UUID,
    "referredName" TEXT NOT NULL,
    "paymentId" UUID NOT NULL,
    "percentBp" INTEGER NOT NULL,
    "baseAmountCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMPTZ(3),
    "paidNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OUTROS',
    "channel" TEXT,
    "amountCents" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "userId" UUID,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" UUID NOT NULL,
    "accountId" UUID,
    "type" TEXT NOT NULL,
    "refKey" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- Planos iniciais (editáveis no painel master)
INSERT INTO "Plan" ("id", "name", "description", "priceCents", "interval", "maxQuizzes", "maxParticipants", "maxUsers", "features", "sortOrder", "updatedAt") VALUES
  ('FREE', 'Gratuito', 'Para experimentar o AZhoot.', 0, 'NONE', 5, 5, 1, '["Até 5 quizzes", "Até 5 pessoas por sessão", "1 usuário", "Relatórios em CSV e XLSX"]', 0, CURRENT_TIMESTAMP),
  ('MONTHLY', 'Mensal', 'Para treinamentos e aulas frequentes.', 990, 'MONTHLY', 20, 20, 3, '["Até 20 quizzes", "Até 20 pessoas por sessão", "3 usuários", "Relatórios em CSV e XLSX", "Relatório semanal por e-mail"]', 1, CURRENT_TIMESTAMP),
  ('YEARLY', 'Anual', 'Para eventos e equipes.', 9900, 'YEARLY', NULL, 200, 10, '["Quizzes ilimitados", "Até 200 pessoas por sessão", "10 usuários", "Relatórios em CSV e XLSX", "Relatório semanal por e-mail"]', 2, CURRENT_TIMESTAMP);

-- Colunas novas em tabelas existentes (nulas até a migração de dados)
ALTER TABLE "User" ADD COLUMN "isMaster" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "accountId" UUID;
ALTER TABLE "Quiz" ADD COLUMN "accountId" UUID;
ALTER TABLE "GameSession" ADD COLUMN "accountId" UUID;

-- Migração de dados: tudo que já existe vira a conta principal do proprietário (master, cortesia no Anual)
DO $$
DECLARE acc UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM "User") THEN
    acc := gen_random_uuid();
    INSERT INTO "Account" ("id", "name", "planId", "billingExempt", "updatedAt")
      VALUES (acc, 'Conta principal', 'YEARLY', true, CURRENT_TIMESTAMP);
    UPDATE "User" SET "accountId" = acc;
    UPDATE "User" SET "isMaster" = true WHERE "role" = 'OWNER';
    UPDATE "Quiz" SET "accountId" = acc;
    UPDATE "GameSession" SET "accountId" = acc;
  END IF;
END $$;

ALTER TABLE "Quiz" ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "GameSession" ALTER COLUMN "accountId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Account_asaasCustomerId_key" ON "Account"("asaasCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_asaasSubscriptionId_key" ON "Account"("asaasSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_affiliateCode_key" ON "Account"("affiliateCode");

-- CreateIndex
CREATE INDEX "Account_planId_subscriptionStatus_idx" ON "Account"("planId", "subscriptionStatus");

-- CreateIndex
CREATE INDEX "Account_createdAt_idx" ON "Account"("createdAt");

-- CreateIndex
CREATE INDEX "Account_referredByAccountId_idx" ON "Account"("referredByAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerId_key" ON "Payment"("providerId");

-- CreateIndex
CREATE INDEX "Payment_accountId_dueDate_idx" ON "Payment"("accountId", "dueDate");

-- CreateIndex
CREATE INDEX "Payment_status_dueDate_idx" ON "Payment"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_type_createdAt_idx" ON "SubscriptionEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_accountId_idx" ON "SubscriptionEvent"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_paymentId_key" ON "Commission"("paymentId");

-- CreateIndex
CREATE INDEX "Commission_affiliateAccountId_status_idx" ON "Commission"("affiliateAccountId", "status");

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "Notification_accountId_createdAt_idx" ON "Notification"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_createdAt_idx" ON "NotificationDelivery"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_type_refKey_toEmail_key" ON "NotificationDelivery"("type", "refKey", "toEmail");

-- CreateIndex
CREATE INDEX "User_accountId_idx" ON "User"("accountId");

-- CreateIndex
CREATE INDEX "Quiz_accountId_status_idx" ON "Quiz"("accountId", "status");

-- CreateIndex
CREATE INDEX "GameSession_accountId_createdAt_idx" ON "GameSession"("accountId", "createdAt");

-- Exclusão de conta remove tudo em cascata
ALTER TABLE "Quiz" DROP CONSTRAINT "Quiz_ownerId_fkey";
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameSession" DROP CONSTRAINT "GameSession_hostUserId_fkey";
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameSession" DROP CONSTRAINT "GameSession_quizVersionId_fkey";
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_quizVersionId_fkey" FOREIGN KEY ("quizVersionId") REFERENCES "QuizVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Answer" DROP CONSTRAINT "Answer_questionId_fkey";
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_referredByAccountId_fkey" FOREIGN KEY ("referredByAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_affiliateAccountId_fkey" FOREIGN KEY ("affiliateAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_referredAccountId_fkey" FOREIGN KEY ("referredAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
