import { describe, expect, it } from 'vitest';
import { nicknameMatchesBlocklist, nicknameSchema, normalizeNickname } from './nickname';

describe('apelidos', () => {
  it('normaliza Unicode, acentos, espaços e caixa', () => {
    expect(normalizeNickname('  JoÃO   Silva ')).toBe(normalizeNickname('joao silva'));
    expect(normalizeNickname('Ｊｏｓé')).toBe('jose');
    expect(normalizeNickname('Maria  Clara')).toBe('maria clara');
  });

  it('valida tamanho e caracteres', () => {
    expect(nicknameSchema.safeParse('A').success).toBe(false);
    expect(nicknameSchema.safeParse('a'.repeat(25)).success).toBe(false);
    expect(nicknameSchema.safeParse('<b>oi</b>').success).toBe(false);
    expect(nicknameSchema.safeParse('Ana_Paula-2').success).toBe(true);
    expect(nicknameSchema.parse('  Zé   Carlos ')).toBe('Zé Carlos');
  });

  it('filtro configurável ignora separadores e acentos', () => {
    expect(nicknameMatchesBlocklist('B.o.b.o', ['bobo'])).toBe(true);
    expect(nicknameMatchesBlocklist('Bóbo123', ['bobo'])).toBe(true);
    expect(nicknameMatchesBlocklist('Roberto', ['bobo'])).toBe(false);
  });
});
