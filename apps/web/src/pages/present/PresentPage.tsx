import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  ChevronRight,
  Eye,
  FileBarChart,
  Lock,
  LogOut,
  Maximize,
  Menu,
  Play,
  RefreshCw,
  Trophy,
  UserX,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CLIENT_EVENTS, GAME_STATUS_LABELS, type SessionSnapshot } from '@azhoot/contracts';
import {
  Button,
  cn,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  LogoMark,
  Spinner,
} from '@azhoot/ui';
import { Leaderboard, Podium } from '@/components/game/Leaderboard';
import { QuestionStage } from '@/components/game/QuestionStage';
import { RevealChart } from '@/components/game/RevealChart';
import { Timer } from '@/components/game/Timer';
import { useRemaining } from '@/components/game/useRemaining';
import { useGameConnection } from '@/hooks/useGameConnection';
import { api, describeError } from '@/lib/api';
import { formatPin } from '@/lib/format';
import { useForcedDark } from '@/lib/theme';
import type { SessionDetail } from '@/lib/types';
import { SessionUnavailable } from '../NotFoundPage';

type Action = {
  label: string;
  event: string;
  icon: typeof Play;
  key: string;
  variant?: 'default' | 'success' | 'secondary';
};

/** Ação principal (Espaço) e secundárias conforme o estado. */
function actionsFor(s: SessionSnapshot): { primary: Action | null; secondary: Action[] } {
  const leaderboardAllowed = !s.settings.hideIntermediateLeaderboard;
  const next: Action = s.isLastQuestion
    ? {
        label: 'Encerrar e ver pódio',
        event: CLIENT_EVENTS.hostNextQuestion,
        icon: Trophy,
        key: 'Espaço',
        variant: 'success',
      }
    : {
        label: 'Próxima pergunta',
        event: CLIENT_EVENTS.hostNextQuestion,
        icon: ChevronRight,
        key: 'Espaço',
      };
  switch (s.status) {
    case 'LOBBY':
      return {
        primary: {
          label: 'Iniciar partida',
          event: CLIENT_EVENTS.hostStart,
          icon: Play,
          key: 'Espaço',
          variant: 'success',
        },
        secondary: [],
      };
    case 'QUESTION_OPEN':
      return {
        primary: {
          label: 'Encerrar respostas',
          event: CLIENT_EVENTS.hostLockQuestion,
          icon: Lock,
          key: 'Espaço',
        },
        secondary: [
          {
            label: 'Revelar',
            event: CLIENT_EVENTS.hostReveal,
            icon: Eye,
            key: 'R',
            variant: 'secondary',
          },
        ],
      };
    case 'QUESTION_LOCKED':
      return {
        primary: {
          label: 'Revelar resposta',
          event: CLIENT_EVENTS.hostReveal,
          icon: Eye,
          key: 'Espaço',
        },
        secondary: [],
      };
    case 'REVEAL':
      if (leaderboardAllowed)
        return {
          primary: {
            label: 'Classificação',
            event: CLIENT_EVENTS.hostShowLeaderboard,
            icon: BarChart3,
            key: 'Espaço',
          },
          secondary: [{ ...next, key: 'N', variant: 'secondary' }],
        };
      return { primary: next, secondary: [] };
    case 'LEADERBOARD':
      return { primary: next, secondary: [] };
    default:
      return { primary: null, secondary: [] };
  }
}

function stageFor(status: string) {
  if (status === 'LOBBY') return 'lobby';
  if (status === 'FINISHED' || status === 'CANCELLED') return 'resultado';
  return 'jogo';
}

function announcement(s: SessionSnapshot): string {
  switch (s.status) {
    case 'COUNTDOWN':
      return 'A partida vai começar.';
    case 'QUESTION_OPEN':
      return `Pergunta ${(s.currentIndex ?? 0) + 1} de ${s.questionCount} aberta.`;
    case 'QUESTION_LOCKED':
      return 'Respostas encerradas.';
    case 'REVEAL':
      return 'Resposta revelada.';
    case 'LEADERBOARD':
      return 'Classificação exibida.';
    case 'FINISHED':
      return 'Partida encerrada. Pódio exibido.';
    default:
      return GAME_STATUS_LABELS[s.status];
  }
}

export default function PresentPage() {
  useForcedDark();
  const { sessionId = '', stage } = useParams();
  const navigate = useNavigate();
  const {
    snapshot: s,
    status,
    error,
    command,
    emit,
    serverNow,
  } = useGameConnection({ sessionId, role: 'host' });
  const detail = useQuery({
    queryKey: ['session', sessionId, s?.pin],
    queryFn: () => api<SessionDetail>(`/sessions/${sessionId}`),
  });
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [toRemove, setToRemove] = useState<{ id: string; nickname: string } | null>(null);
  const busyRef = useRef(false);

  // Mantém a URL coerente com o estado da sessão
  useEffect(() => {
    if (!s) return;
    const expected = stageFor(s.status);
    if (stage !== expected) navigate(`/apresentar/${sessionId}/${expected}`, { replace: true });
  }, [s, stage, sessionId, navigate]);

  const run = useCallback(
    async (event: string, extra: object = {}) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      const ack = await command(event, extra);
      busyRef.current = false;
      setBusy(false);
      if (!ack.ok && ack.error.code !== 'CONFLICT') toast.error(ack.error.message);
    },
    [command],
  );

  const acts = s ? actionsFor(s) : { primary: null, secondary: [] };

  // Atalhos: Espaço (principal), R (revelar), L (classificação), N (próxima), Esc (menu)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!s || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable;
      if (typing || document.querySelector('[role="dialog"],[role="alertdialog"]')) return;
      if (e.code === 'Space') {
        if (el.tagName === 'BUTTON' || el.tagName === 'A') return; // ativação nativa do elemento focado
        e.preventDefault();
        if (acts.primary) void run(acts.primary.event);
      } else if (e.key === 'r' || e.key === 'R') {
        if (s.status === 'QUESTION_OPEN' || s.status === 'QUESTION_LOCKED')
          void run(CLIENT_EVENTS.hostReveal);
      } else if (e.key === 'l' || e.key === 'L') {
        if (s.status === 'REVEAL') void run(CLIENT_EVENTS.hostShowLeaderboard);
      } else if (e.key === 'n' || e.key === 'N') {
        if (s.status === 'REVEAL' || s.status === 'LEADERBOARD')
          void run(CLIENT_EVENTS.hostNextQuestion);
      } else if (e.key === 'Escape') {
        setMenuOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s, acts.primary, run]);

  const { seconds: questionSeconds } = useRemaining(
    s?.status === 'QUESTION_OPEN' ? s.question?.closesAt : null,
    serverNow,
  );
  const { seconds: countdownSeconds } = useRemaining(s?.countdownEndsAt, serverNow);
  const live = useMemo(() => (s ? announcement(s) : ''), [s]);

  if (error?.fatal) {
    return (
      <SessionUnavailable
        title={error.code === 'FORBIDDEN' ? 'Acesso negado' : 'Sessão indisponível'}
        description={
          error.code === 'FORBIDDEN'
            ? 'Somente o apresentador desta sessão pode controlá-la.'
            : error.message
        }
      />
    );
  }
  if (!s) {
    return (
      <div className="bg-waves grid min-h-dvh place-items-center text-white">
        <Spinner label="Conectando à sala…" className="text-slate-200" />
      </div>
    );
  }

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <div className="bg-waves relative flex h-dvh flex-col overflow-hidden text-white">
      <div className="sr-only" aria-live="polite" aria-atomic>
        {live}
      </div>

      {/* Barra superior */}
      <header className="flex items-center gap-[2vmin] px-[3vmin] py-[1.6vmin]">
        <LogoMark className="size-[5vmin] min-h-8 min-w-8" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[2.4vmin] font-semibold">{s.quizTitle}</p>
          <p className="text-[1.6vmin] text-blue-200">{GAME_STATUS_LABELS[s.status]}</p>
        </div>
        {s.pin && s.status !== 'LOBBY' && (
          <div className="rounded-2xl bg-white/10 px-[2vmin] py-[1vmin] text-right">
            <p className="text-[1.4vmin] uppercase tracking-wider text-blue-200">PIN</p>
            <p className="font-display text-[3vmin] font-bold tabular-nums tracking-widest">
              {formatPin(s.pin)}
            </p>
          </div>
        )}
        <div
          className="flex items-center gap-2 rounded-2xl bg-white/10 px-[2vmin] py-[1vmin] text-[2.2vmin] font-semibold"
          aria-label={`${s.participantCount} participantes`}
        >
          <Users className="size-[2.6vmin]" aria-hidden /> {s.participantCount}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-white hover:bg-white/10"
          onClick={() => setMenuOpen(true)}
          aria-label="Menu da sessão (Esc)"
        >
          <Menu />
        </Button>
      </header>

      {status !== 'connected' && (
        <div
          className="mx-[3vmin] flex items-center gap-2 rounded-xl bg-warning px-4 py-2 text-sm font-semibold text-slate-950"
          role="status"
        >
          <WifiOff className="size-4" aria-hidden /> A conexão caiu. Tentando reconectar…
        </div>
      )}

      {/* Conteúdo principal */}
      <main className="flex min-h-0 flex-1 flex-col px-[4vmin] pb-[2vmin] pt-[1vmin]">
        {s.status === 'LOBBY' && (
          <LobbyView
            snapshot={s}
            detail={detail.data}
            onRemove={(p) => setToRemove(p)}
            onRegenerate={async () => {
              try {
                await api(`/sessions/${sessionId}/regenerate-pin`, { method: 'POST' });
                await detail.refetch();
                toast.success('Novo PIN gerado.');
              } catch (e) {
                toast.error(describeError(e));
              }
            }}
          />
        )}

        {s.status === 'COUNTDOWN' && (
          <div className="grid flex-1 place-items-center text-center">
            <div>
              <p className="text-[3vmin] text-blue-200">Prepare-se!</p>
              <p
                className="font-display text-[26vmin] font-bold leading-none tabular-nums animate-pop"
                key={countdownSeconds}
              >
                {countdownSeconds}
              </p>
              <p className="text-[2.4vmin] text-slate-300">{s.questionCount} perguntas</p>
            </div>
          </div>
        )}

        {(s.status === 'QUESTION_OPEN' || s.status === 'QUESTION_LOCKED') && s.question && (
          <QuestionStage
            question={s.question}
            answeredCount={s.answeredCount}
            participantCount={s.participantCount}
            timer={
              s.status === 'QUESTION_OPEN' ? (
                <Timer
                  seconds={questionSeconds}
                  total={s.question.durationSeconds}
                  size={Math.min(140, window.innerHeight * 0.13)}
                />
              ) : (
                <span className="rounded-2xl bg-amber-400 px-[2vmin] py-[1vmin] text-[2.2vmin] font-bold text-slate-950">
                  Tempo encerrado
                </span>
              )
            }
          />
        )}

        {s.status === 'REVEAL' && s.question && s.reveal && (
          <div className="flex min-h-0 flex-1 flex-col gap-[2vmin]">
            <QuestionStage question={s.question} reveal={s.reveal} />
            <div className="grid gap-[2vmin] lg:grid-cols-[1fr_1fr]">
              <RevealChart question={s.question} reveal={s.reveal} />
              {s.reveal.explanation && (
                <div className="self-center rounded-2xl bg-white/10 p-[2.4vmin]">
                  <p className="text-[1.6vmin] font-semibold uppercase tracking-wider text-blue-200">
                    Explicação
                  </p>
                  <p className="mt-1 text-[2.6vmin]">{s.reveal.explanation}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {s.status === 'LEADERBOARD' && (
          <div className="mx-auto flex w-full max-w-[110vmin] flex-1 flex-col justify-center gap-[3vmin]">
            <h2 className="text-center font-display text-[5vmin] font-bold">Classificação</h2>
            <Leaderboard entries={s.leaderboard ?? []} />
          </div>
        )}

        {(s.status === 'FINISHED' || s.status === 'CANCELLED') && (
          <ResultView snapshot={s} sessionId={sessionId} />
        )}
      </main>

      {/* Controles do apresentador */}
      {(acts.primary || acts.secondary.length > 0) && (
        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 bg-night/70 px-[3vmin] py-[1.6vmin] backdrop-blur">
          <p className="mr-auto hidden text-xs text-slate-400 md:block">
            Atalhos: <kbd>Espaço</kbd> avançar · <kbd>R</kbd> revelar · <kbd>L</kbd> classificação ·{' '}
            <kbd>Esc</kbd> menu
          </p>
          {acts.secondary.map((a) => (
            <Button
              key={a.label}
              size="lg"
              variant="outline"
              className="border-white/20 bg-white/5 text-white hover:bg-white/15"
              disabled={busy}
              onClick={() => void run(a.event)}
            >
              <a.icon /> {a.label}{' '}
              <kbd className="ml-1 rounded bg-black/30 px-1.5 text-xs">{a.key}</kbd>
            </Button>
          ))}
          {acts.primary && (
            <Button
              size="lg"
              variant={acts.primary.variant ?? 'default'}
              loading={busy}
              onClick={() => void run(acts.primary!.event)}
            >
              <acts.primary.icon /> {acts.primary.label}{' '}
              <kbd className="ml-1 rounded bg-black/30 px-1.5 text-xs">{acts.primary.key}</kbd>
            </Button>
          )}
        </footer>
      )}

      {/* Menu da sessão */}
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Menu da sessão</DialogTitle>
            <DialogDescription>
              {s.quizTitle} · {GAME_STATUS_LABELS[s.status]}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Button variant="outline" onClick={toggleFullscreen}>
              <Maximize /> Tela cheia
            </Button>
            {s.participants &&
              s.participants.length > 0 &&
              s.status !== 'FINISHED' &&
              s.status !== 'CANCELLED' && (
                <div className="grid gap-1 rounded-xl border border-border p-2">
                  <p className="px-2 text-xs font-semibold uppercase text-muted-foreground">
                    Participantes
                  </p>
                  <ul className="max-h-56 overflow-y-auto">
                    {s.participants.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-muted"
                      >
                        <span className="truncate text-sm">
                          {p.nickname}{' '}
                          {p.status === 'DISCONNECTED' && (
                            <span className="text-xs text-muted-foreground">(desconectado)</span>
                          )}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger"
                          onClick={() => setToRemove(p)}
                        >
                          <UserX /> Remover
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            {s.status !== 'FINISHED' && s.status !== 'CANCELLED' && (
              <Button variant="destructive" onClick={() => setConfirmEnd(true)}>
                <X /> Encerrar sessão
              </Button>
            )}
            <Button variant="ghost" asChild>
              <Link to="/dashboard">
                <LogOut /> Voltar ao painel (a sessão continua)
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title="Encerrar a sessão agora?"
        description={
          s.status === 'LOBBY'
            ? 'A sala será cancelada e o PIN deixará de funcionar.'
            : 'A partida termina imediatamente e o pódio é exibido com a pontuação atual.'
        }
        confirmLabel="Encerrar"
        destructive
        onConfirm={async () => {
          setConfirmEnd(false);
          setMenuOpen(false);
          await run(CLIENT_EVENTS.hostEnd);
        }}
      />
      <ConfirmDialog
        open={!!toRemove}
        onOpenChange={(o) => !o && setToRemove(null)}
        title={`Remover ${toRemove?.nickname ?? ''}?`}
        description="O participante é desconectado e não poderá voltar com a mesma participação. Bloquear também impede reutilizar este apelido nesta sala."
        confirmLabel="Remover e bloquear apelido"
        destructive
        onConfirm={async () => {
          const p = toRemove!;
          setToRemove(null);
          const ack = await emit(CLIENT_EVENTS.hostRemoveParticipant, {
            participantId: p.id,
            block: true,
          });
          if (ack.ok) toast.success(`${p.nickname} foi removido.`);
          else toast.error(ack.error.message);
        }}
      />
    </div>
  );
}

function LobbyView({
  snapshot: s,
  detail,
  onRemove,
  onRegenerate,
}: {
  snapshot: SessionSnapshot;
  detail?: SessionDetail;
  onRemove: (p: { id: string; nickname: string }) => void;
  onRegenerate: () => void;
}) {
  const joinHost = detail?.joinUrl
    ? new URL(detail.joinUrl).host + '/entrar'
    : `${window.location.host}/entrar`;
  const participants = s.participants ?? [];
  return (
    <div className="grid min-h-0 flex-1 gap-[3vmin] lg:grid-cols-[auto_1fr]">
      <section
        className="flex flex-col items-center justify-center gap-[2vmin] rounded-3xl bg-white/5 p-[3vmin] text-center"
        aria-label="Como entrar"
      >
        <p className="text-[2.2vmin] text-blue-200">
          Acesse <strong className="text-white">{joinHost}</strong> e digite o PIN
        </p>
        <p
          className="font-display text-[11vmin] font-bold leading-none tracking-[0.12em] tabular-nums"
          aria-label={`PIN ${s.pin?.split('').join(' ')}`}
        >
          {formatPin(s.pin)}
        </p>
        {detail?.qrSvgDataUri ? (
          <div className="relative rounded-2xl bg-white p-[1.4vmin]">
            <img
              src={detail.qrSvgDataUri}
              alt="QR Code para entrar na sala com o PIN preenchido"
              className="size-[30vmin] min-h-40 min-w-40"
            />
          </div>
        ) : (
          <div className="size-[30vmin] animate-pulse rounded-2xl bg-white/10" />
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-blue-200 hover:bg-white/10 hover:text-white"
          onClick={onRegenerate}
        >
          <RefreshCw /> Gerar novo PIN
        </Button>
      </section>
      <section className="flex min-h-0 flex-col gap-[2vmin]" aria-label="Participantes na sala">
        <div className="flex items-end justify-between">
          <h2 className="font-display text-[4vmin] font-bold">
            {participants.length === 0
              ? 'Aguardando participantes…'
              : `${participants.length} na sala`}
          </h2>
          {participants.length > 0 && (
            <p className="text-[1.8vmin] text-slate-300">Clique em um apelido para remover</p>
          )}
        </div>
        {participants.length === 0 ? (
          <div className="relative grid flex-1 place-items-center">
            <span
              className="absolute size-[20vmin] rounded-full border-4 border-blue-400/40 animate-pulse-ring"
              aria-hidden
            />
            <span
              className="absolute size-[20vmin] rounded-full border-4 border-blue-400/40 animate-pulse-ring [animation-delay:1.2s]"
              aria-hidden
            />
            <Users className="size-[8vmin] text-blue-300" aria-hidden />
          </div>
        ) : (
          <ul
            className="flex flex-wrap content-start gap-[1.2vmin] overflow-y-auto"
            aria-live="polite"
          >
            {participants.map((p) => (
              <li key={p.id} className="animate-rise">
                <button
                  type="button"
                  onClick={() => onRemove(p)}
                  className={cn(
                    'rounded-xl bg-white/12 px-[2vmin] py-[1vmin] text-[2.4vmin] font-semibold transition-colors hover:bg-danger/80 focus-visible:bg-danger/80',
                    p.status === 'DISCONNECTED' && 'opacity-50',
                  )}
                  aria-label={`${p.nickname}${p.status === 'DISCONNECTED' ? ' (desconectado)' : ''}. Remover.`}
                >
                  {p.nickname}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ResultView({ snapshot: s, sessionId }: { snapshot: SessionSnapshot; sessionId: string }) {
  if (s.status === 'CANCELLED') {
    return (
      <div className="grid flex-1 place-items-center text-center">
        <div className="grid gap-4">
          <h2 className="font-display text-[5vmin] font-bold">Sessão cancelada</h2>
          <Button asChild size="lg">
            <Link to="/biblioteca">Abrir outra sala</Link>
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[3vmin]">
      <h2 className="font-display text-[5vmin] font-bold">Pódio</h2>
      {(s.podium ?? []).length === 0 ? (
        <p className="text-slate-300">Nenhum participante pontuou.</p>
      ) : (
        <Podium entries={s.podium ?? []} />
      )}
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild size="lg">
          <Link to={`/relatorios/${sessionId}`}>
            <FileBarChart /> Ver relatório
          </Link>
        </Button>
        <Button
          asChild
          size="lg"
          variant="outline"
          className="border-white/20 bg-white/5 text-white hover:bg-white/15"
        >
          <Link to="/biblioteca">Nova sala</Link>
        </Button>
      </div>
    </div>
  );
}
