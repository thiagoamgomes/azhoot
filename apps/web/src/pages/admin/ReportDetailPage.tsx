import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Download, FileSpreadsheet, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { QUESTION_TYPE_LABELS, type SessionReport } from '@azhoot/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  ErrorState,
  Label,
  Select,
  Skeleton,
} from '@azhoot/ui';
import { PageHeader } from '@/components/layout/AdminLayout';
import { SessionStatusBadge } from '@/components/StatusBadge';
import { optionStyle } from '@/components/game/options';
import { api, ApiError, describeError, download } from '@/lib/api';
import { formatDateTime, formatNumber, formatPercent, formatSeconds } from '@/lib/format';

export default function ReportDetailPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [mode, setMode] = useState<'ANONYMIZE' | 'DELETE'>('ANONYMIZE');
  const q = useQuery({
    queryKey: ['report', sessionId],
    queryFn: () => api<SessionReport>(`/reports/sessions/${sessionId}`),
  });
  const del = useMutation({
    mutationFn: () => api(`/reports/sessions/${sessionId}?mode=${mode}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(mode === 'DELETE' ? 'Relatório excluído.' : 'Participantes anonimizados.');
      setConfirm(false);
      if (mode === 'DELETE') navigate('/relatorios');
      else void q.refetch();
    },
    onError: (e) => toast.error(describeError(e)),
  });

  async function exportAs(format: 'csv' | 'xlsx') {
    setExporting(format);
    try {
      await download(
        `/reports/sessions/${sessionId}/export?format=${format}`,
        `azhoot-relatorio.${format}`,
      );
    } catch (err) {
      toast.error(describeError(err));
    } finally {
      setExporting(null);
    }
  }

  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError)
    return (
      <ErrorState
        title={
          q.error instanceof ApiError && q.error.status === 404
            ? 'Sessão não encontrada'
            : q.error instanceof ApiError && q.error.status === 403
              ? 'Acesso negado'
              : 'Não foi possível carregar'
        }
        description={describeError(q.error)}
        action={
          <Button asChild>
            <Link to="/relatorios">Voltar aos relatórios</Link>
          </Button>
        }
      />
    );

  const r = q.data;
  const terminal = r.session.status === 'FINISHED' || r.session.status === 'CANCELLED';
  const hardest = r.questions.find((x) => x.questionId === r.summary.hardestQuestionId);
  const easiest = r.questions.find((x) => x.questionId === r.summary.easiestQuestionId);

  return (
    <>
      <Button variant="ghost" asChild className="mb-2 -ml-2">
        <Link to="/relatorios">
          <ArrowLeft /> Relatórios
        </Link>
      </Button>
      <PageHeader
        title={r.session.quizTitle}
        description={`Apresentado por ${r.session.hostName} · versão v${r.session.quizVersionNumber} · ${formatDateTime(r.session.startedAt ?? r.session.createdAt)} até ${formatDateTime(r.session.endedAt)}`}
        actions={
          <>
            <Button variant="outline" loading={exporting === 'csv'} onClick={() => exportAs('csv')}>
              <Download /> CSV
            </Button>
            <Button
              variant="outline"
              loading={exporting === 'xlsx'}
              onClick={() => exportAs('xlsx')}
            >
              <FileSpreadsheet /> XLSX
            </Button>
            {terminal && (
              <Button variant="ghost" className="text-danger" onClick={() => setConfirm(true)}>
                <Trash2 /> Excluir dados
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <SessionStatusBadge status={r.session.status} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Participantes', formatNumber(r.summary.participants)],
          ['Respostas', formatNumber(r.summary.answers)],
          ['Taxa média de acerto', formatPercent(r.summary.averageAccuracy)],
          ['Tempo médio de resposta', formatSeconds(r.summary.averageResponseMs)],
        ].map(([label, value]) => (
          <Card key={label} className="p-5">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 font-display text-2xl font-bold">{value}</p>
          </Card>
        ))}
      </div>
      {(hardest || easiest) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {hardest && (
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase text-danger">Maior dificuldade</p>
              <p className="mt-1 text-sm font-medium">
                P{hardest.position + 1}: {hardest.prompt}{' '}
                <span className="text-muted-foreground">({formatPercent(hardest.accuracy)})</span>
              </p>
            </Card>
          )}
          {easiest && (
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase text-success-strong">
                Menor dificuldade
              </p>
              <p className="mt-1 text-sm font-medium">
                P{easiest.position + 1}: {easiest.prompt}{' '}
                <span className="text-muted-foreground">({formatPercent(easiest.accuracy)})</span>
              </p>
            </Card>
          )}
        </div>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Classificação final</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {r.participants.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum participante.</p>
          ) : (
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pr-3">
                    Posição
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Apelido
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right">
                    Pontos
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right">
                    Acertos
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right">
                    Respondidas
                  </th>
                  <th scope="col" className="py-2 text-right">
                    Tempo médio
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.participants.map((p) => (
                  <tr key={p.participantId}>
                    <td className="py-2 pr-3 font-semibold">{p.rank ? `${p.rank}º` : '—'}</td>
                    <td className="py-2 pr-3">
                      {p.nickname}{' '}
                      {(p.status === 'REMOVED' || p.status === 'BLOCKED') && (
                        <Badge variant="muted">Removido</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatNumber(p.totalScore)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{p.correctCount}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{p.answeredCount}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatSeconds(p.averageResponseMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Perguntas</h2>
      <div className="grid gap-4">
        {r.questions.map((qq) => {
          const max = Math.max(1, ...qq.options.map((o) => o.count));
          return (
            <Card key={qq.questionId}>
              <CardHeader>
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  Pergunta {qq.position + 1} · {QUESTION_TYPE_LABELS[qq.type]} · {qq.basePoints} pts
                </p>
                <CardTitle className="text-base">{qq.prompt}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {qq.totalAnswers} resposta(s)
                  {qq.accuracy != null && ` · ${formatPercent(qq.accuracy)} de acerto`} · tempo
                  médio {formatSeconds(qq.averageResponseMs)}
                </p>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2">
                  {qq.options.map((o, i) => (
                    <li
                      key={o.optionId}
                      className="grid grid-cols-[auto_1fr_auto] items-center gap-3"
                    >
                      <span
                        className={`rounded-md px-2 py-0.5 text-xs font-bold ${optionStyle(i).chip}`}
                      >
                        {optionStyle(i).letter}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1 text-sm">
                          <span className="truncate">{o.text}</span>
                          {o.isCorrect && (
                            <Check className="size-4 shrink-0 text-success" aria-label="Correta" />
                          )}
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <div
                            className={`h-full rounded-full ${o.isCorrect ? 'bg-success' : 'bg-primary/60'}`}
                            style={{ width: `${(o.count / max) * 100}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-sm tabular-nums">{o.count}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Excluir dados da sessão?"
        description={
          <span className="grid gap-3">
            <span>
              Escolha como tratar os dados dos participantes. A ação não pode ser desfeita.
            </span>
            <span className="grid gap-1.5">
              <Label htmlFor="del-mode">Modo</Label>
              <Select
                id="del-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="ANONYMIZE">Anonimizar participantes (mantém estatísticas)</option>
                <option value="DELETE">Excluir sessão e respostas</option>
              </Select>
            </span>
          </span>
        }
        confirmLabel={mode === 'DELETE' ? 'Excluir' : 'Anonimizar'}
        destructive
        loading={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </>
  );
}
