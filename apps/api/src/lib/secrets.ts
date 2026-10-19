import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Criptografia AES-256-GCM para segredos guardados no banco (chaves de API). */
function key(secret: string) {
  return createHash('sha256').update(`azhoot-secrets:${secret}`).digest();
}

export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    enc.toString('base64url'),
  ].join('.');
}

export function decryptSecret(payload: string | null | undefined, secret: string): string | null {
  if (!payload) return null;
  const [v, iv, tag, data] = payload.split('.');
  if (v !== 'v1' || !iv || !tag || !data) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Mostra só o final do segredo (ex.: "••••••abcd"). */
export function maskSecret(plain: string | null): string | null {
  if (!plain) return null;
  return `••••••${plain.slice(-4)}`;
}
