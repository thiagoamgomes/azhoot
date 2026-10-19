-- Anexos na geração com IA: contagem de anexos e créditos consumidos por geração.
ALTER TABLE "AiGeneration" ADD COLUMN "attachments" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiGeneration" ADD COLUMN "creditsUsed" INTEGER NOT NULL DEFAULT 1;
