import { z } from 'zod';
import {
  LIMITS,
  QUESTION_DURATIONS,
  QUESTION_POINTS,
  QUESTION_TYPES,
  QUIZ_STATUSES,
  type QuestionType,
} from './constants';

/** Caminho de imagem aceito: somente arquivos servidos pelo próprio AZhoot. */
export const imageUrlSchema = z
  .string()
  .regex(/^\/uploads\/[a-z0-9-]{8,80}\.(webp|png|jpe?g)$/, 'Imagem inválida')
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const trimmed = (max: number) => z.string().trim().max(max);

export const questionTypeSchema = z.enum(QUESTION_TYPES);
export const durationSchema = z
  .number()
  .int()
  .refine((v) => (QUESTION_DURATIONS as readonly number[]).includes(v), 'Tempo inválido');
export const pointsSchema = z
  .number()
  .int()
  .refine((v) => (QUESTION_POINTS as readonly number[]).includes(v), 'Pontuação inválida');

export const optionDraftSchema = z.object({
  id: z.uuid().optional(),
  text: trimmed(LIMITS.optionTextMax),
  imageUrl: imageUrlSchema,
  isCorrect: z.boolean().default(false),
});
export type OptionDraftInput = z.input<typeof optionDraftSchema>;
export type OptionDraft = z.output<typeof optionDraftSchema>;

export const questionDraftSchema = z.object({
  id: z.uuid().optional(),
  type: questionTypeSchema,
  prompt: trimmed(LIMITS.promptMax),
  imageUrl: imageUrlSchema,
  durationSeconds: durationSchema,
  basePoints: pointsSchema,
  explanation: trimmed(LIMITS.explanationMax)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  options: z.array(optionDraftSchema).max(LIMITS.optionsMax),
});
export type QuestionDraftInput = z.input<typeof questionDraftSchema>;
export type QuestionDraft = z.output<typeof questionDraftSchema>;

export const quizMetaSchema = z.object({
  title: trimmed(LIMITS.quizTitleMax),
  description: trimmed(LIMITS.quizDescriptionMax)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  category: trimmed(LIMITS.quizCategoryMax)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  coverImageUrl: imageUrlSchema,
});

export const quizCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(LIMITS.quizTitleMin, 'Informe um título com pelo menos 3 caracteres')
    .max(LIMITS.quizTitleMax),
  description: quizMetaSchema.shape.description,
  category: quizMetaSchema.shape.category,
});
export type QuizCreateInput = z.input<typeof quizCreateSchema>;

/** Conteúdo completo de rascunho, salvo por autosave. Validação leniente. */
export const quizDraftSchema = quizMetaSchema.extend({
  questions: z.array(questionDraftSchema).max(LIMITS.questionsMax),
});
export type QuizDraftInput = z.input<typeof quizDraftSchema>;
export type QuizDraft = z.output<typeof quizDraftSchema>;

export const quizListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z
    .enum([...QUIZ_STATUSES, 'ALL'])
    .optional()
    .default('ALL'),
  sort: z.enum(['updatedAt', 'title', 'createdAt', 'sessions']).optional().default('updatedAt'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
  publishedOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type QuizListQuery = z.output<typeof quizListQuerySchema>;

/** Problema de validação de publicação. `questionIndex` é base 0. */
export interface PublishIssue {
  path: string;
  message: string;
  questionIndex?: number;
}

/** Normaliza campos dependentes do tipo (ex.: enquete sem pontos). */
export function normalizeQuestion<Q extends QuestionDraft>(q: Q): Q {
  if (q.type === 'POLL') {
    return { ...q, basePoints: 0, options: q.options.map((o) => ({ ...o, isCorrect: false })) };
  }
  return q;
}

export const TRUE_FALSE_TEXTS = ['Verdadeiro', 'Falso'] as const;

export function defaultOptionsFor(type: QuestionType): OptionDraft[] {
  if (type === 'TRUE_FALSE') {
    return TRUE_FALSE_TEXTS.map((text, i) => ({ text, imageUrl: null, isCorrect: i === 0 }));
  }
  return [
    { text: '', imageUrl: null, isCorrect: type !== 'POLL' },
    { text: '', imageUrl: null, isCorrect: false },
  ];
}

/**
 * Validação completa para publicação. Usada pela API (autoritativa) e pela web (prévia).
 */
export function validateQuizForPublish(quiz: {
  title: string;
  questions: QuestionDraft[];
}): PublishIssue[] {
  const issues: PublishIssue[] = [];
  const title = quiz.title.trim();
  if (title.length < LIMITS.quizTitleMin) {
    issues.push({ path: 'title', message: 'O título precisa ter pelo menos 3 caracteres.' });
  }
  if (quiz.questions.length === 0) {
    issues.push({ path: 'questions', message: 'Adicione pelo menos uma pergunta.' });
  }
  quiz.questions.forEach((raw, qi) => {
    const q = normalizeQuestion(raw);
    const n = qi + 1;
    const push = (path: string, message: string) =>
      issues.push({
        path: `questions.${qi}.${path}`,
        message: `Pergunta ${n}: ${message}`,
        questionIndex: qi,
      });
    const prompt = q.prompt.trim();
    if (prompt.length < LIMITS.promptMin || prompt.length > LIMITS.promptMax) {
      push('prompt', 'o enunciado deve ter de 3 a 300 caracteres.');
    }
    if (!(QUESTION_DURATIONS as readonly number[]).includes(q.durationSeconds)) {
      push('durationSeconds', 'tempo inválido.');
    }
    if (!(QUESTION_POINTS as readonly number[]).includes(q.basePoints)) {
      push('basePoints', 'pontuação inválida.');
    }
    const texts = q.options.map((o) => o.text.trim());
    const correct = q.options.filter((o) => o.isCorrect).length;
    if (q.type === 'TRUE_FALSE') {
      if (q.options.length !== 2)
        push('options', 'verdadeiro ou falso precisa de exatamente 2 alternativas.');
      if (correct !== 1) push('options', 'marque qual alternativa é a correta.');
    } else {
      if (q.options.length < LIMITS.optionsMin || q.options.length > LIMITS.optionsMax) {
        push('options', 'use de 2 a 6 alternativas.');
      }
    }
    texts.forEach((t, oi) => {
      if (t.length === 0) push(`options.${oi}.text`, `a alternativa ${oi + 1} está vazia.`);
    });
    const lower = texts.filter(Boolean).map((t) => t.toLocaleLowerCase('pt-BR'));
    if (new Set(lower).size !== lower.length) push('options', 'existem alternativas repetidas.');
    if (q.type === 'SINGLE_CHOICE' && correct !== 1) {
      push('options', 'única escolha precisa de exatamente 1 alternativa correta.');
    }
    if (q.type === 'MULTIPLE_CHOICE' && correct < 2) {
      push('options', 'múltipla escolha precisa de pelo menos 2 alternativas corretas.');
    }
  });
  return issues;
}
