import {
  AI_ATTACHMENT_MIME,
  MAX_AI_ATTACHMENT_CHARS,
  MAX_AI_ATTACHMENT_IMAGES,
  MAX_AI_ATTACHMENTS,
} from '@azhoot/contracts';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import sharp from 'sharp';
import { AppError } from '../../lib/errors';

/** Arquivo recebido via multipart (memory storage). */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

export interface ExtractedAttachments {
  /** Texto extraído dos documentos (PDF/DOCX/Excel), já saneado e com teto de tamanho. */
  text: string;
  /** Imagens convertidas para data URL (JPEG) para envio à visão do modelo. */
  images: { dataUrl: string }[];
  /** Nomes dos anexos processados, para o prompt e para auditoria. */
  names: string[];
  /** Verdadeiro se houve pelo menos um anexo válido. */
  hasFiles: boolean;
}

function kindOf(file: UploadedFile): 'pdf' | 'docx' | 'excel' | 'image' | null {
  const byMime = AI_ATTACHMENT_MIME[file.mimetype];
  if (byMime) return byMime;
  // Alguns navegadores enviam mimetype genérico; cai para a extensão.
  const ext = file.originalname.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'xlsx' || ext === 'xls') return 'excel';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'image';
  return null;
}

async function pdfToText(buffer: Buffer): Promise<string> {
  // pdf-parse 2.x: instancia com os bytes e extrai o texto.
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function docxToText(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer });
  return value ?? '';
}

async function excelToText(buffer: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const parts: string[] = [];
  wb.eachSheet((sheet) => {
    parts.push(`# ${sheet.name}`);
    sheet.eachRow((row) => {
      const cells = (row.values as unknown[]).slice(1).map((v) => cellText(v));
      if (cells.some((c) => c.length > 0)) parts.push(cells.join(' | '));
    });
  });
  return parts.join('\n');
}

function cellText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; hyperlink?: string };
    if (typeof o.text === 'string') return o.text;
    if (o.result != null) return String(o.result);
    if (typeof o.hyperlink === 'string') return o.hyperlink;
    return '';
  }
  return String(v);
}

async function imageToDataUrl(buffer: Buffer): Promise<string> {
  // Redimensiona para limitar tokens de visão e remove metadados; JPEG para tamanho previsível.
  const out = await sharp(buffer, { limitInputPixels: 8000 * 8000 })
    .rotate()
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return `data:image/jpeg;base64,${out.toString('base64')}`;
}

/**
 * Processa os anexos da geração com IA: extrai texto de documentos e converte imagens
 * para data URL. Aplica limites de quantidade e de tamanho de texto. Lança ATTACHMENT_*
 * quando um anexo é inválido ou não produz conteúdo utilizável.
 */
export async function extractAttachments(files: UploadedFile[]): Promise<ExtractedAttachments> {
  if (files.length === 0) return { text: '', images: [], names: [], hasFiles: false };
  if (files.length > MAX_AI_ATTACHMENTS)
    throw new AppError('ATTACHMENT_INVALID', { reason: `Máximo de ${MAX_AI_ATTACHMENTS} anexos.` });

  const docTexts: string[] = [];
  const images: { dataUrl: string }[] = [];
  const names: string[] = [];
  let chars = 0;

  for (const file of files) {
    const kind = kindOf(file);
    if (!kind) throw new AppError('ATTACHMENT_INVALID', { file: file.originalname });
    names.push(file.originalname);

    if (kind === 'image') {
      if (images.length >= MAX_AI_ATTACHMENT_IMAGES)
        throw new AppError('ATTACHMENT_INVALID', {
          reason: `Máximo de ${MAX_AI_ATTACHMENT_IMAGES} imagens.`,
        });
      try {
        images.push({ dataUrl: await imageToDataUrl(file.buffer) });
      } catch {
        throw new AppError('ATTACHMENT_INVALID', { file: file.originalname });
      }
      continue;
    }

    let raw = '';
    try {
      raw =
        kind === 'pdf'
          ? await pdfToText(file.buffer)
          : kind === 'docx'
            ? await docxToText(file.buffer)
            : await excelToText(file.buffer);
    } catch {
      throw new AppError('ATTACHMENT_INVALID', { file: file.originalname });
    }
    const clean = raw
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (clean.length === 0 && images.length === 0)
      throw new AppError('ATTACHMENT_EMPTY', { file: file.originalname });
    if (clean.length > 0 && chars < MAX_AI_ATTACHMENT_CHARS) {
      const room = MAX_AI_ATTACHMENT_CHARS - chars;
      const slice = clean.slice(0, room);
      docTexts.push(`--- ${file.originalname} ---\n${slice}`);
      chars += slice.length;
    }
  }

  // Um lote só de imagens é válido; só de documentos vazios não é.
  if (docTexts.length === 0 && images.length === 0) throw new AppError('ATTACHMENT_EMPTY', {});

  return { text: docTexts.join('\n\n'), images, names, hasFiles: true };
}
