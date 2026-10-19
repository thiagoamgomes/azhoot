import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Token opaco aleatório (base64url). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Hash determinístico com segredo do servidor, para buscar tokens sem armazená-los em claro. */
export function hashToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** PIN de 6 dígitos gerado por CSPRNG, sem zero à esquerda. */
export function generatePin(): string {
  return String(randomInt(100000, 1000000));
}

export function isValidPin(pin: string): boolean {
  return /^[1-9]\d{5}$/.test(pin);
}

/** Embaralhamento Fisher–Yates com CSPRNG. */
export function secureShuffle<T>(items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}
