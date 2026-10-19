import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { extractAttachments, type UploadedFile } from './attachments';

async function xlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Vendas');
  ws.addRow(['Produto', 'Total']);
  ws.addRow(['Camiseta', 42]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function pngBuffer(): Promise<Buffer> {
  return sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 90, b: 200 } },
  })
    .png()
    .toBuffer();
}

function file(over: Partial<UploadedFile> & Pick<UploadedFile, 'buffer'>): UploadedFile {
  return {
    originalname: 'arquivo',
    mimetype: 'application/octet-stream',
    size: over.buffer.length,
    ...over,
  };
}

describe('extractAttachments', () => {
  it('sem arquivos retorna vazio e hasFiles=false', async () => {
    const r = await extractAttachments([]);
    expect(r.hasFiles).toBe(false);
    expect(r.text).toBe('');
    expect(r.images).toHaveLength(0);
  });

  it('extrai texto de planilha Excel', async () => {
    const r = await extractAttachments([
      file({
        buffer: await xlsxBuffer(),
        originalname: 'vendas.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    ]);
    expect(r.hasFiles).toBe(true);
    expect(r.text).toContain('Vendas');
    expect(r.text).toContain('Camiseta');
    expect(r.text).toContain('42');
    expect(r.images).toHaveLength(0);
  });

  it('converte imagem para data URL (JPEG) para a visão', async () => {
    const r = await extractAttachments([
      file({ buffer: await pngBuffer(), originalname: 'foto.png', mimetype: 'image/png' }),
    ]);
    expect(r.hasFiles).toBe(true);
    expect(r.images).toHaveLength(1);
    expect(r.images[0]?.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('reconhece pela extensão quando o mimetype é genérico', async () => {
    const r = await extractAttachments([
      file({
        buffer: await pngBuffer(),
        originalname: 'foto.PNG',
        mimetype: 'application/octet-stream',
      }),
    ]);
    expect(r.images).toHaveLength(1);
  });

  it('recusa tipo não suportado', async () => {
    await expect(
      extractAttachments([
        file({ buffer: Buffer.from('oi'), originalname: 'notas.txt', mimetype: 'text/plain' }),
      ]),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_INVALID' });
  });
});
