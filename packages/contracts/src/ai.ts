import { z } from 'zod';
import { QUESTION_TYPES } from './constants';
import type { QuestionDraftInput } from './quiz';

/** Tipo de perguntas a gerar: um dos tipos, ou VARIED (variado). */
export const GEN_TYPES = ['VARIED', ...QUESTION_TYPES] as const;
export type GenType = (typeof GEN_TYPES)[number];

export const GEN_TYPE_LABELS: Record<GenType, string> = {
  VARIED: 'Variado',
  SINGLE_CHOICE: 'Única escolha',
  MULTIPLE_CHOICE: 'Múltipla escolha',
  TRUE_FALSE: 'Verdadeiro ou falso',
  POLL: 'Enquete (sem resposta certa)',
};

/** Exemplos de nível para orientar quem preenche o formulário. */
export const LEVEL_EXAMPLES = [
  'Educação infantil',
  '5º ano do ensino fundamental',
  '9º ano do ensino fundamental',
  'Ensino médio',
  'Vestibular / ENEM',
  'Graduação',
  'Professores e acadêmicos',
  'Treinamento corporativo',
  'Público geral',
];

export const MAX_GEN_QUESTIONS = 20;

export const generateQuestionsSchema = z.object({
  theme: z.string().trim().min(3, 'Descreva o tema.').max(200),
  level: z.string().trim().max(120).optional(),
  /** Textos, links ou fontes para enriquecer a geração. */
  content: z.string().trim().max(8000).optional(),
  count: z.coerce.number().int().min(1).max(MAX_GEN_QUESTIONS),
  type: z.enum(GEN_TYPES).default('VARIED'),
});
export type GenerateQuestionsInput = z.input<typeof generateQuestionsSchema>;

/** Uma geração só com texto consome 1 crédito, independentemente da quantidade de perguntas. */
export const CREDITS_PER_GENERATION = 1;
/** Uma geração que inclui anexos (PDF, DOCX, Excel, imagem) consome 2 créditos. */
export const CREDITS_PER_GENERATION_WITH_FILE = 2;

/** Custo em créditos de uma geração conforme haja ou não anexos. */
export function generationCreditCost(hasFiles: boolean): number {
  return hasFiles ? CREDITS_PER_GENERATION_WITH_FILE : CREDITS_PER_GENERATION;
}

/* ----------------------------- anexos da IA ----------------------------- */

/** Tipos de anexo aceitos no campo de conteúdo da geração com IA. */
export const AI_ATTACHMENT_MIME: Record<string, 'pdf' | 'docx' | 'excel' | 'image'> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
  'application/vnd.ms-excel': 'excel',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
};

/** Atributo `accept` do input de arquivo (extensões + mimes). */
export const AI_ATTACHMENT_ACCEPT =
  '.pdf,.docx,.xlsx,.xls,image/png,image/jpeg,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Quantos anexos no total, e quantas imagens, cabem numa geração. */
export const MAX_AI_ATTACHMENTS = 5;
export const MAX_AI_ATTACHMENT_IMAGES = 4;
/** Tamanho máximo por anexo, em MB. */
export const MAX_AI_ATTACHMENT_MB = 15;
/** Teto de caracteres de texto extraído de documentos enviado ao modelo. */
export const MAX_AI_ATTACHMENT_CHARS = 16000;

export interface GeneratedQuestions {
  questions: QuestionDraftInput[];
  model: string | null;
  creditsRemaining: number;
  /** Créditos consumidos nesta geração (1 só texto, 2 com anexos). */
  creditsUsed: number;
}

export interface CreditPackDto {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
  active: boolean;
  sortOrder: number;
}

export interface CreditTx {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  note: string | null;
  createdAt: string;
}

export const CREDIT_REASON_LABELS: Record<string, string> = {
  PLAN_GRANT: 'Créditos do plano',
  PURCHASE: 'Compra de pacote',
  GENERATION: 'Geração com IA',
  MASTER_ADJUST: 'Ajuste do suporte',
  REFUND: 'Estorno',
};

export interface CreditOverview {
  balance: number;
  packs: CreditPackDto[];
  transactions: CreditTx[];
}
