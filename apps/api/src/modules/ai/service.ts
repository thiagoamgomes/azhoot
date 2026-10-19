import { randomUUID } from 'node:crypto';
import { generationCreditCost, type GeneratedQuestions } from '@azhoot/contracts';
import type { Account } from '@azhoot/db';
import type { AppContext } from '../../context';
import type { AuthUser } from '@azhoot/contracts';
import { AppError } from '../../lib/errors';
import { assertNotFrozen } from '../billing/service';
import { balanceOf, debitCredits } from '../credits/service';
import { extractAttachments, type UploadedFile } from './attachments';
import { getAiProvider, type GenInput } from './provider';

/**
 * Gera perguntas com IA e debita créditos por geração: 1 crédito só com texto, 2 quando há anexos
 * (PDF, DOCX, Excel ou imagem). A extração dos anexos e a chamada ao provedor ocorrem antes do
 * débito — falhas não consomem crédito.
 */
export async function generate(
  ctx: AppContext,
  account: Account,
  user: AuthUser,
  input: GenInput,
  files: UploadedFile[] = [],
): Promise<GeneratedQuestions> {
  assertNotFrozen(account);

  const attachments = await extractAttachments(files);
  const cost = generationCreditCost(attachments.hasFiles);

  // Evita chamar o provedor sem saldo (o débito abaixo é a verificação autoritativa).
  if ((await balanceOf(ctx, account.id)) < cost)
    throw new AppError('NO_AI_CREDITS', { balance: 0, needed: cost });

  const provider = await getAiProvider(ctx);
  const { questions, model } = await provider.generate({
    ...input,
    attachmentText: attachments.text || undefined,
    images: attachments.images.length ? attachments.images : undefined,
  });

  const genId = randomUUID();
  const creditsRemaining = await debitCredits(ctx, account.id, cost, genId);
  await ctx.prisma.aiGeneration.create({
    data: {
      id: genId,
      accountId: account.id,
      userId: user.id,
      theme: input.theme,
      level: input.level ?? null,
      questionType: input.type,
      count: questions.length,
      model,
      attachments: attachments.names.length,
      creditsUsed: cost,
    },
  });
  ctx.metrics.inc('azhoot_ai_generations_total', {
    type: input.type,
    withFiles: String(attachments.hasFiles),
  });
  return { questions, model, creditsRemaining, creditsUsed: cost };
}
