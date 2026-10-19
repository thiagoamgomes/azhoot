import {
  CheckCircle2,
  Clock,
  Hourglass,
  PartyPopper,
  Trophy,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { GAME_STATUS_LABELS, type SessionSnapshot } from '@azhoot/contracts';
import { Button, cn, Logo, Spinner } from '@azhoot/ui';
import { AnswerPad } from '@/components/game/AnswerPad';
import { optionStyle } from '@/components/game/options';
import { useRemaining } from '@/components/game/useRemaining';
import { useGameConnection } from '@/hooks/useGameConnection';
import { formatNumber } from '@/lib/format';
import { clearParticipant, loadParticipant } from '@/lib/participantStore';
import { useForcedDark } from '@/lib/theme';
import { SessionUnavailable } from '../NotFoundPage';

function Screen({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-4 text-center animate-rise',
        className,
      )}
    >
      {children}
    </div>
  );
}

function rankText(me: SessionSnapshot['me'] | undefined) {
  if (!me?.rank) return null;
  return `Você está em ${me.rank}º lugar`;
}

export default function PlayPage() {
  useForcedDark();
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const stored = useMemo(() => loadParticipant(sessionId), [sessionId]);
  const {
    snapshot: s,
    status,
    error,
    answer,
    serverNow,
  } = useGameConnection({
    sessionId,
    role: 'participant',
    token: stored?.token,
    enabled: !!stored,
  });
  const [submitting, setSubmitting] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(true);
  const { seconds } = useRemaining(
    s?.status === 'QUESTION_OPEN' ? s.question?.closesAt : null,
    serverNow,
  );
  const { seconds: countdown } = useRemaining(s?.countdownEndsAt, serverNow);

  useEffect(() => {
    if (!s) return;
    const onResult = location.pathname.endsWith('/resultado');
    if (s.status === 'FINISHED' && !onResult)
      navigate(`/jogar/${sessionId}/resultado`, { replace: true });
  }, [s, location.pathname, navigate, sessionId]);

  useEffect(() => setAnswerError(null), [s?.question?.id]);

  if (!stored) {
    return (
      <SessionUnavailable
        title="Participação não encontrada"
        description="Entre na sala com o PIN para participar."
      />
    );
  }
  if (error?.fatal) {
    if (error.code === 'PARTICIPANT_REMOVED') clearParticipant(sessionId);
    return (
      <SessionUnavailable
        title={
          error.code === 'PARTICIPANT_REMOVED' ? 'Você foi removido da sala' : 'Sessão indisponível'
        }
        description={
          error.code === 'PARTICIPANT_REMOVED'
            ? 'O apresentador removeu sua participação desta sala.'
            : error.message
        }
      />
    );
  }

  const me = s?.me;
  const q = s?.question;
  const answered =
    me?.currentAnswer && q && me.currentAnswer.questionId === q.id
      ? me.currentAnswer.selectedOptionIds
      : null;

  async function submit(optionIds: string[]) {
    if (!q) return;
    setSubmitting(true);
    setAnswerError(null);
    const ack = await answer(q.id, optionIds);
    setSubmitting(false);
    if (!ack.ok) setAnswerError(ack.error.message);
  }

  return (
    <div className="bg-waves flex min-h-dvh flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-white">
      <header className="flex items-center justify-between gap-2">
        <Logo inverted className="[&_svg]:size-7 [&>span:last-child]:text-base" />
        <div className="text-right">
          <p className="max-w-40 truncate text-sm font-semibold">{stored.nickname}</p>
          {me && (
            <p className="text-xs tabular-nums text-blue-200">{formatNumber(me.totalScore)} pts</p>
          )}
        </div>
      </header>

      {status !== 'connected' && s && (
        <div
          className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-warning px-3 py-2 text-sm font-semibold text-slate-950"
          role="status"
        >
          <WifiOff className="size-4" aria-hidden /> A conexão caiu. Tentando reconectar…
        </div>
      )}

      <main className="flex flex-1 flex-col py-4" aria-live="polite">
        {!s ? (
          <Screen>
            <Spinner label="Conectando à sala…" className="text-slate-200" />
          </Screen>
        ) : s.status === 'LOBBY' ? (
          <Screen>
            <CheckCircle2 className="size-16 text-green-400" aria-hidden />
            <h1 className="text-2xl font-bold">Você está na sala!</h1>
            <p className="text-slate-300">Aguarde o apresentador iniciar a partida.</p>
            <p className="rounded-full bg-white/10 px-4 py-1 text-sm">
              {s.participantCount} participante(s)
            </p>
          </Screen>
        ) : s.status === 'COUNTDOWN' ? (
          <Screen>
            <p className="text-lg text-blue-200">Prepare-se!</p>
            <p className="font-display text-8xl font-bold tabular-nums" aria-hidden>
              {countdown}
            </p>
            <p className="sr-only">A partida vai começar.</p>
          </Screen>
        ) : s.status === 'QUESTION_OPEN' && q ? (
          answered ? (
            <Screen>
              <CheckCircle2 className="size-16 text-blue-300" aria-hidden />
              <h1 className="text-2xl font-bold">Resposta enviada</h1>
              <div className="flex flex-wrap justify-center gap-2">
                {answered.map((id) => {
                  const i = q.options.findIndex((o) => o.id === id);
                  const st = optionStyle(i);
                  return (
                    <span
                      key={id}
                      className={cn('rounded-xl px-3 py-1 text-sm font-semibold', st.tile)}
                    >
                      {st.letter} · {q.options[i]?.text}
                    </span>
                  );
                })}
              </div>
              <p className="text-slate-300">Aguarde a revelação.</p>
            </Screen>
          ) : (
            <div className="flex flex-1 flex-col gap-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-blue-200">
                  Pergunta {q.index + 1}/{q.total}
                </span>
                <button
                  type="button"
                  className="text-xs text-slate-300 underline"
                  onClick={() => setShowPrompt((v) => !v)}
                >
                  {showPrompt ? 'Ocultar enunciado' : 'Mostrar enunciado'}
                </button>
                <span
                  className={cn(
                    'flex items-center gap-1 font-bold tabular-nums',
                    seconds <= 5 && 'text-amber-300',
                  )}
                  aria-hidden
                >
                  <Clock className="size-4" /> {seconds}s
                </span>
              </div>
              {answerError && (
                <p className="rounded-xl bg-red-500/20 px-3 py-2 text-center text-sm" role="alert">
                  {answerError}
                </p>
              )}
              <div className="flex flex-1 flex-col">
                <AnswerPad
                  question={q}
                  submitting={submitting}
                  showPrompt={showPrompt}
                  onSubmit={submit}
                />
              </div>
            </div>
          )
        ) : s.status === 'QUESTION_LOCKED' ? (
          <Screen>
            {answered ? (
              <Hourglass className="size-16 text-blue-300" aria-hidden />
            ) : (
              <Clock className="size-16 text-amber-300" aria-hidden />
            )}
            <h1 className="text-2xl font-bold">
              {answered ? 'Resposta enviada' : 'O tempo acabou'}
            </h1>
            <p className="text-slate-300">Aguarde a revelação da resposta.</p>
          </Screen>
        ) : s.status === 'REVEAL' && me?.lastResult ? (
          <Screen>
            {q?.type === 'POLL' ? (
              <>
                <CheckCircle2 className="size-16 text-blue-300" aria-hidden />
                <h1 className="text-2xl font-bold">
                  {me.lastResult.answered ? 'Obrigado pelo voto!' : 'Você não votou'}
                </h1>
              </>
            ) : me.lastResult.isCorrect ? (
              <>
                <CheckCircle2 className="size-20 text-green-400" aria-hidden />
                <h1 className="text-3xl font-bold">Correto!</h1>
                <p className="font-display text-2xl font-bold text-green-300">
                  +{formatNumber(me.lastResult.scoreAwarded)} pts
                </p>
              </>
            ) : (
              <>
                <XCircle className="size-20 text-red-400" aria-hidden />
                <h1 className="text-3xl font-bold">
                  {me.lastResult.answered ? 'Não foi dessa vez' : 'Sem resposta'}
                </h1>
              </>
            )}
            {s.reveal?.explanation && (
              <p className="max-w-sm rounded-2xl bg-white/10 p-3 text-sm">{s.reveal.explanation}</p>
            )}
            <p className="text-slate-200">
              Total: <strong className="tabular-nums">{formatNumber(me.totalScore)} pts</strong>
            </p>
            {rankText(me) && <p className="text-lg font-semibold text-blue-200">{rankText(me)}</p>}
          </Screen>
        ) : s.status === 'LEADERBOARD' ? (
          <Screen>
            <Trophy className="size-16 text-amber-300" aria-hidden />
            <h1 className="text-2xl font-bold">{rankText(me) ?? 'Classificação'}</h1>
            <p className="font-display text-3xl font-bold tabular-nums">
              {formatNumber(me?.totalScore ?? 0)} pts
            </p>
            <p className="text-slate-300">Veja a classificação na tela.</p>
          </Screen>
        ) : s.status === 'FINISHED' ? (
          <Screen>
            <PartyPopper className="size-20 text-amber-300" aria-hidden />
            <h1 className="text-3xl font-bold">Fim de jogo!</h1>
            {me?.rank ? (
              <p className="text-xl font-semibold text-blue-200">
                Você terminou em {me.rank}º lugar
              </p>
            ) : (
              <p className="text-slate-300">Obrigado por participar.</p>
            )}
            <p className="font-display text-4xl font-bold tabular-nums">
              {formatNumber(me?.totalScore ?? 0)} pts
            </p>
            <p className="text-sm text-slate-300">
              {me?.correctCount ?? 0} acerto(s) de {s.questionCount} pergunta(s)
            </p>
            <Button
              asChild
              variant="outline"
              className="border-white/20 bg-white/5 text-white hover:bg-white/15"
            >
              <Link
                to="/entrar"
                onClick={() => {
                  clearParticipant(sessionId);
                }}
              >
                Entrar em outra sala
              </Link>
            </Button>
          </Screen>
        ) : s.status === 'CANCELLED' ? (
          <Screen>
            <h1 className="text-2xl font-bold">A sessão foi encerrada</h1>
            <p className="text-slate-300">O apresentador cancelou esta sala.</p>
          </Screen>
        ) : (
          <Screen>
            <p>{GAME_STATUS_LABELS[s.status]}</p>
          </Screen>
        )}
      </main>
    </div>
  );
}
