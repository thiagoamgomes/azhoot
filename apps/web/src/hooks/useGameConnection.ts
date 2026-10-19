import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  CLIENT_EVENTS,
  CONTRACT_VERSION,
  SERVER_EVENTS,
  errorMessage,
  serverEnvelopeSchema,
  type Ack,
  type AnswerAcceptedPayload,
  type AnswersProgressPayload,
  type ClockSyncResponse,
  type ErrorCode,
  type ParticipantPresencePayload,
  type SessionSnapshot,
} from '@azhoot/contracts';
import { API_ORIGIN } from '@/lib/config';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface GameError {
  code: ErrorCode | 'CONNECTION_FAILED';
  message: string;
  fatal: boolean;
}

const SNAPSHOT_EVENTS = [
  SERVER_EVENTS.snapshot,
  SERVER_EVENTS.countdown,
  SERVER_EVENTS.questionOpened,
  SERVER_EVENTS.questionLocked,
  SERVER_EVENTS.reveal,
  SERVER_EVENTS.leaderboard,
  SERVER_EVENTS.finished,
] as const;

const FATAL: ErrorCode[] = [
  'PARTICIPANT_REMOVED',
  'PARTICIPANT_TOKEN_INVALID',
  'SESSION_NOT_FOUND',
  'FORBIDDEN',
  'UNAUTHENTICATED',
];

interface Options {
  sessionId: string;
  role: 'host' | 'participant';
  /** Token do participante (obrigatório para role=participant). */
  token?: string | null;
  enabled?: boolean;
}

/**
 * Conexão Socket.IO com a sessão. O estado exibido é sempre derivado do último snapshot
 * enviado pelo servidor (fonte única de verdade), com pequenos patches de presença/progresso.
 */
export function useGameConnection({ sessionId, role, token, enabled = true }: Options) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<GameError | null>(null);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const offsetRef = useRef(0);
  const seqRef = useRef(-1);
  const pendingAnswer = useRef<{
    questionId: string;
    answerId: string;
    optionIds: string[];
  } | null>(null);

  const emit = useCallback(
    async <T>(event: string, payload: object, timeoutMs = 6000): Promise<Ack<T>> => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        return {
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'Sem conexão. Tentando reconectar…' },
        };
      }
      try {
        return (await socket.timeout(timeoutMs).emitWithAck(event, {
          v: CONTRACT_VERSION,
          eventId: crypto.randomUUID(),
          sessionId,
          payload,
        })) as Ack<T>;
      } catch {
        return {
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'O servidor não respondeu a tempo.' },
        };
      }
    },
    [sessionId],
  );

  const applySnapshot = useCallback((snap: SessionSnapshot, event?: string) => {
    if (snap.seq < seqRef.current) return; // evento antigo/fora de ordem
    seqRef.current = snap.seq;
    setSnapshot(snap);
    if (event) setLastEvent(event);
  }, []);

  useEffect(() => {
    if (!enabled || (role === 'participant' && !token)) return;
    const socket = io(`${API_ORIGIN}/game`, {
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
    socketRef.current = socket;

    const syncClock = async () => {
      let best = { rtt: Infinity, offset: 0 };
      for (let i = 0; i < 3; i++) {
        const t0 = Date.now();
        try {
          const res = (await socket
            .timeout(3000)
            .emitWithAck(CLIENT_EVENTS.clockSync, {})) as Ack<ClockSyncResponse>;
          const t1 = Date.now();
          if (res.ok) {
            const rtt = t1 - t0;
            const offset = new Date(res.data.serverTime).getTime() - (t0 + rtt / 2);
            if (rtt < best.rtt) best = { rtt, offset };
          }
        } catch {
          /* ignora */
        }
      }
      if (best.rtt < Infinity) offsetRef.current = best.offset;
    };

    const attach = async () => {
      const ack =
        role === 'host'
          ? await emit<SessionSnapshot>(CLIENT_EVENTS.hostJoin, {})
          : await emit<SessionSnapshot>(CLIENT_EVENTS.participantResume, {
              token,
              lastSeq: Math.max(0, seqRef.current),
            });
      if (ack.ok) {
        seqRef.current = -1; // snapshot de reconexão é autoritativo
        applySnapshot(ack.data);
        setError(null);
        setStatus('connected');
        // Reenvia resposta pendente com o mesmo answerId (idempotente)
        const pending = pendingAnswer.current;
        if (
          pending &&
          ack.data.question?.id === pending.questionId &&
          !ack.data.me?.currentAnswer
        ) {
          void emit(CLIENT_EVENTS.participantAnswer, pending);
        }
      } else {
        setError({
          code: ack.error.code,
          message: ack.error.message,
          fatal: FATAL.includes(ack.error.code),
        });
        if (FATAL.includes(ack.error.code)) socket.disconnect();
      }
      void syncClock();
    };

    socket.on('connect', () => void attach());
    socket.on('disconnect', (reason) => {
      setStatus(reason === 'io client disconnect' ? 'offline' : 'reconnecting');
    });
    socket.io.on('reconnect_attempt', () => setStatus('reconnecting'));
    socket.on('connect_error', () =>
      setStatus((s) => (s === 'connecting' ? 'connecting' : 'reconnecting')),
    );

    const valid = (raw: unknown) => {
      const parsed = serverEnvelopeSchema.safeParse(raw);
      return parsed.success && parsed.data.sessionId === sessionId ? parsed.data : null;
    };

    for (const ev of SNAPSHOT_EVENTS) {
      socket.on(ev, (raw: unknown) => {
        const env = valid(raw);
        if (env) applySnapshot(env.payload as SessionSnapshot, ev);
      });
    }

    const presence = (raw: unknown) => {
      const env = valid(raw);
      if (!env) return;
      const p = env.payload as ParticipantPresencePayload;
      setSnapshot((s) => {
        if (!s) return s;
        let participants = s.participants;
        if (participants) {
          const others = participants.filter((x) => x.id !== p.participant.id);
          participants =
            p.reason === 'removed' || p.reason === 'blocked'
              ? others
              : [
                  ...others,
                  {
                    id: p.participant.id,
                    nickname: p.participant.nickname,
                    status: p.participant.status,
                    totalScore:
                      participants.find((x) => x.id === p.participant.id)?.totalScore ?? 0,
                  },
                ];
          // mantém ordem de entrada
          const order = new Map(s.participants!.map((x, i) => [x.id, i]));
          participants.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
        }
        return { ...s, participantCount: p.participantCount, participants };
      });
    };
    socket.on(SERVER_EVENTS.participantJoined, presence);
    socket.on(SERVER_EVENTS.participantLeft, presence);

    socket.on(SERVER_EVENTS.answersProgress, (raw: unknown) => {
      const env = valid(raw);
      if (!env) return;
      const p = env.payload as AnswersProgressPayload;
      setSnapshot((s) =>
        s && s.question?.id === p.questionId
          ? { ...s, answeredCount: p.answeredCount, participantCount: p.participantCount }
          : s,
      );
    });

    socket.on(SERVER_EVENTS.answerAccepted, (raw: unknown) => {
      const env = valid(raw);
      if (!env) return;
      const p = env.payload as AnswerAcceptedPayload;
      if (pendingAnswer.current?.questionId === p.questionId) pendingAnswer.current = null;
      setSnapshot((s) =>
        s?.me && s.question?.id === p.questionId
          ? {
              ...s,
              me: {
                ...s.me,
                currentAnswer: { questionId: p.questionId, selectedOptionIds: p.selectedOptionIds },
              },
            }
          : s,
      );
    });

    socket.on(SERVER_EVENTS.error, (raw: unknown) => {
      const env = valid(raw);
      if (!env) return;
      const p = env.payload as { code: ErrorCode; message?: string };
      setError({
        code: p.code,
        message: p.message ?? errorMessage(p.code),
        fatal: FATAL.includes(p.code),
      });
    });

    return () => {
      socket.removeAllListeners();
      socket.io.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [sessionId, role, token, enabled, emit, applySnapshot]);

  /** Envia comando do host com a sequência esperada (evita avanço duplicado). */
  const command = useCallback(
    (event: string, extra: object = {}) =>
      emit<{ seq: number; status: string }>(event, { expectedSeq: seqRef.current, ...extra }),
    [emit],
  );

  /** Envia resposta com answerId estável por pergunta: repetições são idempotentes. */
  const answer = useCallback(
    async (questionId: string, optionIds: string[]) => {
      const existing = pendingAnswer.current;
      const payload =
        existing && existing.questionId === questionId
          ? { ...existing, optionIds }
          : { questionId, optionIds, answerId: crypto.randomUUID() };
      pendingAnswer.current = payload;
      const ack = await emit<AnswerAcceptedPayload>(CLIENT_EVENTS.participantAnswer, payload);
      if (ack.ok) {
        pendingAnswer.current = null;
        setSnapshot((s) =>
          s?.me
            ? {
                ...s,
                me: {
                  ...s.me,
                  currentAnswer: { questionId, selectedOptionIds: ack.data.selectedOptionIds },
                },
              }
            : s,
        );
      } else if (ack.error.code !== 'INTERNAL_ERROR') {
        // Erro definitivo (prazo, já respondida…): não reenviar
        pendingAnswer.current = null;
      }
      return ack;
    },
    [emit],
  );

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  return { snapshot, status, error, lastEvent, command, answer, emit, serverNow };
}
