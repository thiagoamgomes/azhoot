/**
 * Seed idempotente: cria o proprietário e, opcionalmente, um quiz de demonstração publicado.
 * Uso: pnpm db:seed (lê SEED_OWNER_* do .env).
 */
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { createPrismaClient } from './src/index';

const prisma = createPrismaClient();

async function main() {
  const email = (process.env.SEED_OWNER_EMAIL ?? 'owner@azhoot.local').trim().toLowerCase();
  const name = process.env.SEED_OWNER_NAME ?? 'Proprietário';
  let password = process.env.SEED_OWNER_PASSWORD ?? '';
  let generated = false;
  if (!password) {
    password = randomBytes(12).toString('base64url');
    generated = true;
  }
  if (password.length < 10)
    throw new Error('SEED_OWNER_PASSWORD precisa ter pelo menos 10 caracteres.');

  let owner = await prisma.user.findUnique({ where: { email } });
  if (!owner) {
    // Conta principal do master: plano Anual como cortesia (sem cobrança).
    const account = await prisma.account.create({
      data: { name: 'Conta principal', planId: 'YEARLY', billingExempt: true },
    });
    owner = await prisma.user.create({
      data: {
        accountId: account.id,
        isMaster: true,
        email,
        name,
        role: 'OWNER',
        canViewAllReports: true,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      },
    });
    console.log(`Proprietário criado: ${email}`);
    if (generated) console.log(`Senha gerada (anote e troque depois): ${password}`);
  } else {
    console.log(`Proprietário já existe: ${email} (senha não alterada)`);
  }

  if ((process.env.SEED_DEMO_QUIZ ?? 'true') === 'true') {
    const exists = await prisma.quiz.findFirst({ where: { title: 'Demonstração AZhoot' } });
    if (!exists) {
      await prisma.$transaction(async (tx) => {
        const quiz = await tx.quiz.create({
          data: {
            accountId: owner.accountId!,
            ownerId: owner.id,
            title: 'Demonstração AZhoot',
            description: 'Quiz de exemplo com os quatro tipos de pergunta.',
            category: 'Exemplo',
            status: 'PUBLISHED',
          },
        });
        const version = await tx.quizVersion.create({
          data: {
            quizId: quiz.id,
            versionNumber: 1,
            status: 'PUBLISHED',
            title: quiz.title,
            publishedAt: new Date(),
          },
        });
        const questions = [
          {
            type: 'SINGLE_CHOICE' as const,
            prompt: 'Qual é a capital do Brasil?',
            durationSeconds: 20,
            basePoints: 1000,
            explanation: 'Brasília é a capital federal desde 1960.',
            options: [
              ['Brasília', true],
              ['Rio de Janeiro', false],
              ['São Paulo', false],
              ['Salvador', false],
            ],
          },
          {
            type: 'MULTIPLE_CHOICE' as const,
            prompt: 'Quais destas cores são primárias no modelo RGB?',
            durationSeconds: 30,
            basePoints: 1000,
            explanation: 'RGB: vermelho, verde e azul.',
            options: [
              ['Vermelho', true],
              ['Verde', true],
              ['Azul', true],
              ['Amarelo', false],
            ],
          },
          {
            type: 'TRUE_FALSE' as const,
            prompt: 'A luz viaja mais rápido que o som.',
            durationSeconds: 10,
            basePoints: 500,
            explanation: null,
            options: [
              ['Verdadeiro', true],
              ['Falso', false],
            ],
          },
          {
            type: 'POLL' as const,
            prompt: 'Qual formato de evento você prefere?',
            durationSeconds: 20,
            basePoints: 0,
            explanation: null,
            options: [
              ['Presencial', false],
              ['On-line', false],
              ['Híbrido', false],
            ],
          },
        ];
        for (const [position, q] of questions.entries()) {
          await tx.question.create({
            data: {
              quizVersionId: version.id,
              position,
              type: q.type,
              prompt: q.prompt,
              durationSeconds: q.durationSeconds,
              basePoints: q.basePoints,
              explanation: q.explanation,
              options: {
                create: q.options.map(([text, isCorrect], i) => ({
                  text: text as string,
                  isCorrect: isCorrect as boolean,
                  position: i,
                })),
              },
            },
          });
        }
        await tx.quiz.update({ where: { id: quiz.id }, data: { publishedVersionId: version.id } });
      });
      console.log('Quiz de demonstração criado.');
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
