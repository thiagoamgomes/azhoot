import ExcelJS from 'exceljs';
import { QUESTION_TYPE_LABELS, type SessionReport } from '@azhoot/contracts';

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
const secs = (ms: number | null) => (ms == null ? '' : (ms / 1000).toFixed(1).replace('.', ','));
const pct = (v: number | null) => (v == null ? '' : `${Math.round(v * 100)}%`);

/** Evita injeção de fórmula em planilhas (CSV/XLSX). */
function safe(v: unknown): string {
  const s = String(v ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function csvCell(v: unknown): string {
  const s = safe(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function answerLabel(report: SessionReport, participantId: string, questionId: string) {
  const a = report.answers.find(
    (x) => x.participantId === participantId && x.questionId === questionId,
  );
  if (!a) return '—';
  const q = report.questions.find((x) => x.questionId === questionId);
  const texts = a.selectedOptionIds
    .map((id) => q?.options.find((o) => o.optionId === id)?.text ?? '?')
    .join(' + ');
  const mark = a.isCorrect === null ? '' : a.isCorrect ? ' (certa)' : ' (errada)';
  return `${texts}${mark}`;
}

/** CSV UTF-8 com BOM e separador `;` (abre corretamente no Excel em pt-BR). */
export function toCsv(report: SessionReport): Buffer {
  const header = [
    'Posição',
    'Apelido',
    'Pontuação',
    'Acertos',
    'Respondidas',
    'Tempo médio (s)',
    'Situação',
    ...report.questions.map((q) => `P${q.position + 1}: ${q.prompt}`),
  ];
  const rows = report.participants.map((p) => [
    p.rank || '',
    p.nickname,
    p.totalScore,
    p.correctCount,
    p.answeredCount,
    secs(p.averageResponseMs),
    p.status === 'REMOVED' || p.status === 'BLOCKED' ? 'Removido' : 'Participou',
    ...report.questions.map((q) => answerLabel(report, p.participantId, q.questionId)),
  ]);
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(';'));
  return Buffer.concat([
    Buffer.from('﻿', 'utf8'),
    Buffer.from(lines.join('\r\n') + '\r\n', 'utf8'),
  ]);
}

export async function toXlsx(report: SessionReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AZhoot';
  wb.created = new Date();
  const headerStyle = (ws: ExcelJS.Worksheet) => {
    const row = ws.getRow(1);
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };

  const resumo = wb.addWorksheet('Resumo');
  resumo.columns = [
    { header: 'Campo', key: 'k', width: 32 },
    { header: 'Valor', key: 'v', width: 60 },
  ];
  const s = report.session;
  const hardest = report.questions.find((q) => q.questionId === report.summary.hardestQuestionId);
  const easiest = report.questions.find((q) => q.questionId === report.summary.easiestQuestionId);
  [
    ['Quiz', s.quizTitle],
    ['Versão', s.quizVersionNumber],
    ['Apresentador', s.hostName],
    ['Início', fmtDate(s.startedAt)],
    ['Fim', fmtDate(s.endedAt)],
    ['Participantes', report.summary.participants],
    ['Respostas', report.summary.answers],
    ['Taxa média de acerto', pct(report.summary.averageAccuracy)],
    ['Tempo médio de resposta (s)', secs(report.summary.averageResponseMs)],
    ['Pergunta mais difícil', hardest ? `P${hardest.position + 1}: ${hardest.prompt}` : ''],
    ['Pergunta mais fácil', easiest ? `P${easiest.position + 1}: ${easiest.prompt}` : ''],
  ].forEach(([k, v]) => resumo.addRow({ k: safe(k), v: typeof v === 'number' ? v : safe(v) }));
  headerStyle(resumo);

  const part = wb.addWorksheet('Participantes');
  part.columns = [
    { header: 'Posição', key: 'rank', width: 10 },
    { header: 'Apelido', key: 'nickname', width: 28 },
    { header: 'Pontuação', key: 'score', width: 12 },
    { header: 'Acertos', key: 'correct', width: 10 },
    { header: 'Respondidas', key: 'answered', width: 12 },
    { header: 'Tempo médio (s)', key: 'avg', width: 16 },
    { header: 'Situação', key: 'status', width: 14 },
    ...report.questions.map((q) => ({
      header: `P${q.position + 1}`,
      key: `q${q.position}`,
      width: 26,
    })),
  ];
  for (const p of report.participants) {
    const row: Record<string, unknown> = {
      rank: p.rank || '',
      nickname: safe(p.nickname),
      score: p.totalScore,
      correct: p.correctCount,
      answered: p.answeredCount,
      avg: p.averageResponseMs == null ? '' : Number((p.averageResponseMs / 1000).toFixed(1)),
      status: p.status === 'REMOVED' || p.status === 'BLOCKED' ? 'Removido' : 'Participou',
    };
    for (const q of report.questions)
      row[`q${q.position}`] = safe(answerLabel(report, p.participantId, q.questionId));
    part.addRow(row);
  }
  headerStyle(part);

  const perg = wb.addWorksheet('Perguntas');
  perg.columns = [
    { header: 'Nº', key: 'n', width: 6 },
    { header: 'Pergunta', key: 'prompt', width: 50 },
    { header: 'Tipo', key: 'type', width: 20 },
    { header: 'Pontos', key: 'points', width: 10 },
    { header: 'Respostas', key: 'answers', width: 12 },
    { header: 'Acertos', key: 'correct', width: 10 },
    { header: 'Taxa de acerto', key: 'acc', width: 14 },
    { header: 'Tempo médio (s)', key: 'avg', width: 16 },
    { header: 'Distribuição', key: 'dist', width: 60 },
  ];
  for (const q of report.questions) {
    perg.addRow({
      n: q.position + 1,
      prompt: safe(q.prompt),
      type: QUESTION_TYPE_LABELS[q.type],
      points: q.basePoints,
      answers: q.totalAnswers,
      correct: q.type === 'POLL' ? '' : q.correctAnswers,
      acc: q.accuracy == null ? '' : Number(q.accuracy.toFixed(4)),
      avg: q.averageResponseMs == null ? '' : Number((q.averageResponseMs / 1000).toFixed(1)),
      dist: safe(
        q.options.map((o) => `${o.text}${o.isCorrect ? ' ✓' : ''}: ${o.count}`).join(' | '),
      ),
    });
  }
  perg.getColumn('acc').numFmt = '0%';
  headerStyle(perg);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
