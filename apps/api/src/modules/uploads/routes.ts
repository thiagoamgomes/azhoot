import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import type { AppContext } from '../../context';
import { AppError } from '../../lib/errors';
import { rateLimit } from '../../middleware/rateLimit';
import { requirePermission } from '../auth/middleware';

const ALLOWED = new Set(['jpeg', 'png', 'webp']);
const MAX_DIMENSION = 8000;
const OUTPUT_MAX = 1600;

/** Upload autenticado de imagem. Valida o conteúdo real e re-codifica para WebP sem metadados. */
export function uploadRoutes(ctx: AppContext) {
  const r = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ctx.env.UPLOAD_MAX_MB * 1024 * 1024, files: 1 },
  });

  r.post(
    '/images',
    requirePermission('editQuizzes'),
    rateLimit(ctx, 'upload', 60, 10 * 60, (req) => req.user?.id ?? req.ip ?? 'x'),
    upload.single('file'),
    async (req, res) => {
      const file = req.file;
      if (!file) throw new AppError('UPLOAD_INVALID', { reason: 'Nenhum arquivo enviado' });
      let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
      try {
        meta = await sharp(file.buffer, { limitInputPixels: MAX_DIMENSION * MAX_DIMENSION }).metadata();
      } catch {
        throw new AppError('UPLOAD_INVALID', { reason: 'Conteúdo não é uma imagem válida' });
      }
      if (!meta.format || !ALLOWED.has(meta.format)) {
        throw new AppError('UPLOAD_INVALID', { reason: 'Formato não suportado' });
      }
      if (!meta.width || !meta.height || meta.width < 16 || meta.height < 16 || meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) {
        throw new AppError('UPLOAD_INVALID', { reason: 'Dimensões inválidas' });
      }
      const output = await sharp(file.buffer)
        .rotate()
        .resize({ width: OUTPUT_MAX, height: OUTPUT_MAX, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      const key = `${randomUUID()}.webp`;
      await ctx.storage.put(key, output.data, 'image/webp');
      res.status(201).json({ url: `/uploads/${key}`, width: output.info.width, height: output.info.height });
    },
  );

  return r;
}

/** Serve arquivos enviados com cabeçalhos seguros (nunca executáveis). */
export function uploadServeRoutes(ctx: AppContext) {
  const r = Router();
  r.get('/:key', async (req, res) => {
    const file = await ctx.storage.get(req.params.key);
    if (!file) throw new AppError('NOT_FOUND');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(file.data);
  });
  return r;
}
