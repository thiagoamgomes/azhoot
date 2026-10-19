import { z } from 'zod';
import { LIMITS } from './constants';

/**
 * Normaliza apelido para comparação de unicidade e filtro:
 * NFKC, remove marcas diacríticas, colapsa espaços, caixa baixa.
 */
export function normalizeNickname(input: string): string {
  return input
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

/** Limpa o apelido para exibição (mantém acentos, colapsa espaços). */
export function cleanNickname(input: string): string {
  return input.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** Letras, números, espaço e alguns sinais simples. Sem HTML. */
const NICKNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._\-']*$/u;

export const nicknameSchema = z
  .string()
  .transform(cleanNickname)
  .pipe(
    z
      .string()
      .min(LIMITS.nicknameMin, 'O apelido precisa ter pelo menos 2 caracteres.')
      .max(LIMITS.nicknameMax, 'O apelido pode ter no máximo 24 caracteres.')
      .regex(NICKNAME_PATTERN, 'Use apenas letras, números, espaço, ponto, hífen ou sublinhado.'),
  );

/** Verifica se o apelido contém algum termo bloqueado (comparação normalizada, sem separadores). */
export function nicknameMatchesBlocklist(nickname: string, blocklist: readonly string[]): boolean {
  const compact = normalizeNickname(nickname).replace(/[\s._\-']/g, '');
  return blocklist.some((term) => {
    const t = normalizeNickname(term).replace(/[\s._\-']/g, '');
    return t.length > 0 && compact.includes(t);
  });
}
