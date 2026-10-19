-- PIN único apenas entre sessões ativas (não representável no schema Prisma).
-- A API limpa o PIN (NULL) ao encerrar/cancelar a sessão; o índice parcial é a garantia final.
CREATE UNIQUE INDEX "GameSession_active_pin_key" ON "GameSession"("pin")
  WHERE "pin" IS NOT NULL AND "status" NOT IN ('FINISHED', 'CANCELLED');

-- Garante e-mail normalizado em minúsculas.
ALTER TABLE "User" ADD CONSTRAINT "User_email_lowercase_check" CHECK ("email" = lower("email"));
