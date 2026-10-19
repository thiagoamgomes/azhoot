import { useMutation, useQuery } from '@tanstack/react-query';
import { Play, Radio, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LIMITS, type SessionListItem, type SessionSettings } from '@azhoot/contracts';
import {
  Alert,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Input,
  Label,
  Skeleton,
  Switch,
} from '@azhoot/ui';
import { PageHeader } from '@/components/layout/AdminLayout';
import { SessionStatusBadge } from '@/components/StatusBadge';
import { api, describeError } from '@/lib/api';
import { assetUrl } from '@/lib/config';
import { formatDateTime } from '@/lib/format';
import type { QuizListItem, SessionDetail } from '@/lib/types';

const DEFAULTS: SessionSettings = {
  shuffleQuestions: false,
  shuffleOptions: false,
  allowLateJoin: true,
  hideIntermediateLeaderboard: false,
  nicknameModeration: true,
  maxParticipants: LIMITS.maxParticipantsPerSession,
};

const OPTIONS: {
  key: keyof Omit<SessionSettings, 'maxParticipants'>;
  label: string;
  hint: string;
}[] = [
  {
    key: 'shuffleQuestions',
    label: 'Embaralhar perguntas',
    hint: 'A ordem das perguntas muda nesta sessão.',
  },
  {
    key: 'shuffleOptions',
    label: 'Embaralhar alternativas',
    hint: 'Não se aplica a verdadeiro ou falso.',
  },
  {
    key: 'allowLateJoin',
    label: 'Permitir entrada tardia',
    hint: 'Participantes podem entrar após o início.',
  },
  {
    key: 'hideIntermediateLeaderboard',
    label: 'Ocultar classificação intermediária',
    hint: 'O ranking aparece somente no final.',
  },
  {
    key: 'nicknameModeration',
    label: 'Moderação de apelidos',
    hint: 'Aplica o filtro de termos configurado.',
  },
];

function SessionSetupDialog({ quiz, onClose }: { quiz: QuizListItem | null; onClose: () => void }) {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<SessionSettings>(DEFAULTS);
  useEffect(() => setSettings(DEFAULTS), [quiz?.id]);
  const create = useMutation({
    mutationFn: () => api<SessionDetail>('/sessions', { body: { quizId: quiz!.id, settings } }),
    onSuccess: (s) => navigate(`/apresentar/${s.id}/lobby`),
  });
  return (
    <Dialog open={!!quiz} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Abrir sala</DialogTitle>
          <DialogDescription>
            {quiz?.title} · {quiz?.publishedQuestionCount} pergunta(s) · versão v
            {quiz?.publishedVersionNumber}
          </DialogDescription>
        </DialogHeader>
        {create.isError && <Alert variant="danger">{describeError(create.error)}</Alert>}
        <ul className="grid gap-3">
          {OPTIONS.map((o) => (
            <li key={o.key} className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor={`opt-${o.key}`}>{o.label}</Label>
                <p className="text-xs text-muted-foreground" id={`opt-${o.key}-hint`}>
                  {o.hint}
                </p>
              </div>
              <Switch
                id={`opt-${o.key}`}
                aria-describedby={`opt-${o.key}-hint`}
                checked={settings[o.key]}
                onCheckedChange={(v) => setSettings((s) => ({ ...s, [o.key]: v }))}
              />
            </li>
          ))}
          <li className="flex items-center justify-between gap-4">
            <Label htmlFor="opt-max">Limite de participantes</Label>
            <Input
              id="opt-max"
              type="number"
              min={2}
              max={LIMITS.maxParticipantsPerSession}
              className="w-28"
              value={settings.maxParticipants}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  maxParticipants: Math.min(
                    LIMITS.maxParticipantsPerSession,
                    Math.max(2, Number(e.target.value) || 2),
                  ),
                }))
              }
            />
          </li>
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={create.isPending} onClick={() => create.mutate()}>
            <Radio /> Abrir sala
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const quizzes = useQuery({
    queryKey: ['quizzes', 'published', search.trim()],
    queryFn: () =>
      api<{ items: QuizListItem[] }>(
        `/quizzes?publishedOnly=true&status=PUBLISHED${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`,
      ),
    placeholderData: (p) => p,
  });
  const active = useQuery({
    queryKey: ['sessions', 'active'],
    queryFn: () => api<{ items: SessionListItem[] }>('/sessions?scope=active'),
  });
  const preselected = params.get('quiz');
  const chosen = quizzes.data?.items.find((q) => q.id === preselected) ?? null;

  return (
    <>
      <PageHeader
        title="Apresentar"
        description="Escolha um quiz publicado para abrir uma sala ao vivo."
      />

      {active.data && active.data.items.length > 0 && (
        <Card className="mb-6 border-warning/50 p-4">
          <h2 className="mb-2 text-sm font-semibold">Sessões em andamento</h2>
          <ul className="grid gap-2">
            {active.data.items.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  <strong>{s.quizTitle}</strong> · PIN {s.pin} · {formatDateTime(s.createdAt)}
                </span>
                <span className="flex items-center gap-2">
                  <SessionStatusBadge status={s.status} />
                  <Button asChild size="sm">
                    <Link to={`/apresentar/${s.id}`}>Retomar controle</Link>
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <label className="relative mb-4 block max-w-md">
        <span className="sr-only">Buscar quizzes publicados</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          className="pl-9"
          placeholder="Buscar quizzes publicados"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>

      {quizzes.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : quizzes.isError ? (
        <ErrorState
          description={describeError(quizzes.error)}
          action={<Button onClick={() => quizzes.refetch()}>Tentar novamente</Button>}
        />
      ) : quizzes.data.items.length === 0 ? (
        <EmptyState
          title="Nenhum quiz publicado"
          description="Publique um quiz para poder apresentá-lo."
          action={
            <Button asChild>
              <Link to="/quizzes">Ir para quizzes</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {quizzes.data.items.map((q) => (
            <li key={q.id}>
              <Card className="flex h-full flex-col overflow-hidden">
                <div className="relative h-28 bg-gradient-to-br from-primary to-deep">
                  {q.coverImageUrl && (
                    <img
                      src={assetUrl(q.coverImageUrl)}
                      alt=""
                      className="size-full object-cover"
                    />
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <h2 className="font-display text-base font-semibold">{q.title}</h2>
                  <p className="text-xs text-muted-foreground">
                    {q.publishedQuestionCount} pergunta(s) · v{q.publishedVersionNumber} ·{' '}
                    {q.sessionCount} sessão(ões)
                  </p>
                  <Button className="mt-auto" onClick={() => setParams({ quiz: q.id })}>
                    <Play /> Apresentar
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <SessionSetupDialog quiz={chosen} onClose={() => setParams({})} />
    </>
  );
}
