import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Abstração de armazenamento de arquivos. Em desenvolvimento usa disco local;
 * em produção pode ser trocada por um adaptador S3 com a mesma interface (ver ADR 0004).
 */
export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;
  remove(key: string): Promise<void>;
}

const KEY = /^[a-z0-9-]{8,80}\.(webp|png|jpe?g)$/;

export class LocalStorage implements Storage {
  constructor(private readonly dir: string) {}

  private path(key: string) {
    if (!KEY.test(key)) throw new Error('chave de arquivo inválida');
    return resolve(this.dir, key);
  }

  async put(key: string, data: Buffer) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(key), data, { flag: 'wx' });
  }

  async get(key: string) {
    if (!KEY.test(key)) return null;
    try {
      const p = this.path(key);
      await stat(p);
      const ext = key.split('.').pop();
      const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return { data: await readFile(p), contentType };
    } catch {
      return null;
    }
  }

  async remove(key: string) {
    await unlink(this.path(key)).catch(() => undefined);
  }
}
