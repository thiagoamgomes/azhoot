import {
  defaultOptionsFor,
  type QuestionDraft,
  type QuestionDraftInput,
  type QuestionType,
} from '@azhoot/contracts';
import type { EditorOption, EditorQuestion, QuizDetail, ServerQuestion } from '@/lib/types';

let seq = 0;
export const newKey = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Converte uma pergunta gerada pela IA em pergunta do editor (com chaves locais). */
export function fromGenerated(q: QuestionDraftInput): EditorQuestion {
  return {
    key: newKey(),
    type: q.type,
    prompt: q.prompt ?? '',
    imageUrl: null,
    durationSeconds: q.durationSeconds ?? 20,
    basePoints: q.basePoints ?? (q.type === 'POLL' ? 0 : 1000),
    explanation: q.explanation ?? null,
    options: (q.options ?? []).map((o) => ({
      key: newKey(),
      text: o.text ?? '',
      imageUrl: null,
      isCorrect: !!o.isCorrect,
    })),
  };
}

export interface EditorDraft {
  title: string;
  description: string;
  category: string;
  coverImageUrl: string | null;
  questions: EditorQuestion[];
}

export function fromServerQuestion(q: ServerQuestion): EditorQuestion {
  return {
    id: q.id,
    key: q.id,
    type: q.type,
    prompt: q.prompt,
    imageUrl: q.imageUrl,
    durationSeconds: q.durationSeconds,
    basePoints: q.basePoints,
    explanation: q.explanation,
    options: q.options.map((o) => ({
      id: o.id,
      key: o.id,
      text: o.text,
      imageUrl: o.imageUrl,
      isCorrect: o.isCorrect,
    })),
  };
}

export function fromDetail(d: QuizDetail): EditorDraft {
  return {
    title: d.title,
    description: d.description ?? '',
    category: d.category ?? '',
    coverImageUrl: d.coverImageUrl,
    questions: d.questions.map(fromServerQuestion),
  };
}

export function toQuestionDraft(q: EditorQuestion): QuestionDraft {
  return {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    imageUrl: q.imageUrl,
    durationSeconds: q.durationSeconds,
    basePoints: q.type === 'POLL' ? 0 : q.basePoints,
    explanation: q.explanation || null,
    options: q.options.map((o) => ({
      id: o.id,
      text: o.text,
      imageUrl: o.imageUrl,
      isCorrect: q.type === 'POLL' ? false : o.isCorrect,
    })),
  };
}

export function toPayload(d: EditorDraft) {
  return {
    title: d.title,
    description: d.description || null,
    category: d.category || null,
    coverImageUrl: d.coverImageUrl,
    questions: d.questions.map(toQuestionDraft),
  };
}

export function newQuestion(type: QuestionType = 'SINGLE_CHOICE'): EditorQuestion {
  return {
    key: newKey(),
    type,
    prompt: '',
    imageUrl: null,
    durationSeconds: 20,
    basePoints: type === 'POLL' ? 0 : 1000,
    explanation: null,
    options: defaultOptionsFor(type).map((o) => ({ ...o, key: newKey() })),
  };
}

/** Converte a pergunta ao trocar o tipo, preservando o que fizer sentido. */
export function changeType(q: EditorQuestion, type: QuestionType): EditorQuestion {
  if (q.type === type) return q;
  let options: EditorOption[] = q.options;
  if (type === 'TRUE_FALSE') {
    options = defaultOptionsFor('TRUE_FALSE').map((o) => ({ ...o, key: newKey() }));
  } else if (q.type === 'TRUE_FALSE') {
    options = defaultOptionsFor(type).map((o) => ({ ...o, key: newKey() }));
  } else if (type === 'SINGLE_CHOICE') {
    const first = options.findIndex((o) => o.isCorrect);
    options = options.map((o, i) => ({ ...o, isCorrect: i === (first >= 0 ? first : 0) }));
  } else if (type === 'POLL') {
    options = options.map((o) => ({ ...o, isCorrect: false }));
  }
  return { ...q, type, options, basePoints: type === 'POLL' ? 0 : q.basePoints || 1000 };
}

export function duplicateQuestion(q: EditorQuestion): EditorQuestion {
  return {
    ...q,
    id: undefined,
    key: newKey(),
    options: q.options.map((o) => ({ ...o, id: undefined, key: newKey() })),
  };
}

/** Aplica os IDs retornados pelo servidor (mesma estrutura, por posição). */
export function mergeServerIds(d: EditorDraft, server: ServerQuestion[]): EditorDraft {
  if (server.length !== d.questions.length) return d;
  return {
    ...d,
    questions: d.questions.map((q, i) => {
      const s = server[i]!;
      if (s.options.length !== q.options.length) return { ...q, id: s.id };
      return { ...q, id: s.id, options: q.options.map((o, j) => ({ ...o, id: s.options[j]!.id })) };
    }),
  };
}
