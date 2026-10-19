import { useQuery } from '@tanstack/react-query';
import type { CreditOverview, GeneratedQuestions, GenerateQuestionsInput } from '@azhoot/contracts';
import { api } from './api';
import { useAuth } from './auth';

export const CREDITS_KEY = ['account', 'credits'] as const;

export function useCredits() {
  const { user } = useAuth();
  return useQuery({
    queryKey: CREDITS_KEY,
    queryFn: () => api<CreditOverview>('/account/credits'),
    enabled: !!user,
    staleTime: 15_000,
  });
}

export function generateQuestions(input: GenerateQuestionsInput, files: File[] = []) {
  if (files.length === 0) return api<GeneratedQuestions>('/account/ai/generate', { body: input });
  const fd = new FormData();
  fd.set('theme', input.theme);
  if (input.level) fd.set('level', input.level);
  if (input.content) fd.set('content', input.content);
  fd.set('count', String(input.count));
  fd.set('type', input.type ?? 'VARIED');
  for (const file of files) fd.append('files', file);
  return api<GeneratedQuestions>('/account/ai/generate', { formData: fd });
}

export function buyCreditPack(
  packId: string,
  billing?: {
    billingName?: string;
    billingDocument?: string;
    billingEmail?: string;
    billingPhone?: string;
  },
) {
  return api<{ invoiceUrl: string | null }>(`/account/credits/packs/${packId}/checkout`, {
    body: billing ?? {},
  });
}
