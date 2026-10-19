import { randomUUID } from 'node:crypto';
import {
  COUNTDOWN_SECONDS,
  CONTRACT_VERSION,
  SERVER_EVENTS,
  cleanNickname,
  nicknameMatchesBlocklist,
  normalizeNickname,
  type AnswerAcceptedPayload,
  type AnswersProgressPayload,
  type ParticipantPresencePayload,
  type ServerEnvelope,
  type ServerEventName,
  type SessionSnapshot,
} from '@azhoot/contracts';
import type { Prisma } from '@azhoot/db';
import type { AppContext } from '../../context';
import { hashToken, randomToken } from '../../lib/crypto';
import { AppError, isUniqueViolation } from '../../lib/errors';
import { withSessionLock } from '../../lib/lock';
import { keys } from '../../lib/redis';
import { getSettings } from '../settings/service';
import { computeScore, evaluateAnswer, rankParticipants } from './scoring';
import { hostSnapshot, participantSnapshot, prepare, type SessionView } from './snapshot';
import { currentQuestionId, parseSession, type ParsedSession } from './sessionState';
import { isTerminal, nextStatus, type GameAction } from './stateMachine';
import { getVersion } from './versionCache';

export type HostCommand = 'start' | 'lock' | 'reveal' | 'leaderboard' | 'next' | 'end';

export const rooms = {
  all: (sid: string) => `s:${sid}`,
  host: (sid: string) => `s:${sid}:host`,
  participant: (pid: string) => `p:${pid}`,
};

/** Tempo de tolerância para disparar o timer de fechamento depois do prazo. */
const TIMER_GRACE_MS = 30;
const PROGRESS_THROTTLE_MS = 200;
const SNAPSHOT_TTL_SECONDS = 24 * 3600;

const EVENT_FOR_STATUS: Record<string, ServerEventName> = {
  COUNTDOWN: SERVER_EVENTS.countdown,
  QUESTION_OPEN: SERVER_EVENTS.questionOpened,
  QUESTION_LOCKED: SERVER_EVENTS.questionLocked,
  REVEAL: SERVER_EVENTS.reveal,
  LEADERBOARD: SERVER_EVENTS.leaderboard,
  FINISHED: SERVER_EVENTS.finished,
  CANCELLED: SERVER_EVENTS.finished,
  LOBBY: SERVER_EVENTS.snapshot,
};

export interface AnswerResult {
  duplicate: boolean;
  answerId: string;
  questionId: string;
  selectedOptionIds: string[];
}

/**
 * Motor de jogo autoritativo. Estado durável no PostgreSQL (com `stateVersion` otimista),
 * coordenação/presença no Redis e timers locais reconstruídos a partir dos timestamps persistidos.
 */
export class GameEngine {
  private timers = new Map<string, NodeJS.Timeout>();
  private progressTimers = new Map<string, NodeJS.Timeout>();
  private stopped = false;

  constructor(private readonly ctx: AppContext) {}

  /* ---------------------------------------------------------------- */
  /* Utilidades                                                        */
  /* ---------------------------------------------------------------- */

  envelope<P>(sessionId: string, seq: number, payload: P): ServerEnvelope<P> {
    return {
      v: CONTRACT_VERSION,
      eventId: randomUUID(),
      sessionId,
      serverTime: new Date().toISOString(),
      seq,
      payload,
    };
  }

  async loadSession(sessionId: string): Promise<ParsedSession> {
    const s = await this.ctx.prisma.gameSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new AppError('SESSION_NOT_FOUND');
    return parseSession(s);
  }

  async loadView(sessionId: string, session?: ParsedSession): Promise<SessionView> {
    const s = session ?? (await this.loadSession(sessionId));
    const qid = currentQuestionId(s);
    const [version, participants, answers] = await Promise.all([
      getVersion(this.ctx, s.quizVersionId),
      this.ctx.prisma.participant.findMany({
        where: { gameSessionId: sessionId },
        select: {
          id: true,
          nickname: true,
          status: true,
          totalScore: true,
          correctCount: true,
          totalResponseTimeMs: true,
        },
        orderBy: { joinedAt: 'asc' },
      }),
      qid
        ? this.ctx.prisma.answer.findMany({
            where: { gameSessionId: sessionId, questionId: qid },
            select: {
              participantId: true,
              clientAnswerId: true,
              selectedOptionIds: true,
              isCorrect: true,
              scoreAwarded: true,
              responseTimeMs: true,
            },
          })
        : Promise.resolve([]),
    ]);
    return { session: s, version, participants, answers };
  }

  async snapshotFor(
    sessionId: string,
    role: 'host' | 'participant',
    participantId?: string,
  ): Promise<SessionSnapshot> {
    const view = await this.loadView(sessionId);
    const pc = prepare(view);
    return role === 'host' ? hostSnapshot(view, pc) : participantSnapshot(view, pc, participantId!);
  }

  /** Envia o estado atual para todos: host recebe visão completa; cada participante, a sua. */
  async broadcast(sessionId: string, event: ServerEventName, session?: ParsedSession) {
    const io = this.ctx.io;
    const started = Date.now();
    const view = await this.loadView(sessionId, session);
    const pc = prepare(view);
    const seq = view.session.stateVersion;
    const host = hostSnapshot(view, pc);
    // Snapshot público (sem dados pessoais) guardado no Redis para diagnóstico/recuperação.
    const { participants: _p, pin: _pin, ...publicSnap } = host;
    await this.ctx.redis
      .set(
        keys.snapshot(sessionId),
        JSON.stringify({ ...publicSnap, answeredCount: null }),
        'EX',
        SNAPSHOT_TTL_SECONDS,
      )
      .catch(() => undefined);
    if (!io) return;
    io.to(rooms.host(sessionId)).emit(event, this.envelope(sessionId, seq, host));
    for (const p of view.participants) {
      if (p.status === 'REMOVED' || p.status === 'BLOCKED') continue;
      io.to(rooms.participant(p.id)).emit(
        event,
        this.envelope(sessionId, seq, participantSnapshot(view, pc, p.id)),
      );
    }
    this.ctx.metrics.observe('azhoot_broadcast_ms', Date.now() - started);
  }

  /* ---------------------------------------------------------------- */
  /* Transições                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Executa um comando do host (ou do sistema). Idempotente por `eventId` e protegido por `expectedSeq`.
   */
  async command(
    sessionId: string,
    command: HostCommand | 'countdownDone',
    opts: { expectedSeq?: number; eventId?: string; actorId?: string | null } = {},
  ): Promise<{ seq: number; status: string }> {
    if (opts.eventId) {
      const prev = await this.ctx.redis.get(keys.hostCmd(opts.eventId));
      if (prev) return JSON.parse(prev) as { seq: number; status: string };
    }
    const result = await withSessionLock(this.ctx.redis, sessionId, async () => {
      let s = await this.loadSession(sessionId);
      if (opts.expectedSeq !== undefined && opts.expectedSeq !== s.stateVersion) {
        throw new AppError('CONFLICT', {
          expectedSeq: opts.expectedSeq,
          currentSeq: s.stateVersion,
        });
      }
      const now = new Date();
      switch (command) {
        case 'start':
          if (s.questionOrder.length === 0) throw new AppError('SESSION_NO_QUESTIONS');
          s = await this.transition(s, 'start', 'game:countdown', {
            startedAt: now,
            countdownEndsAt: new Date(now.getTime() + COUNTDOWN_SECONDS * 1000),
          });
          break;
        case 'countdownDone':
          s = await this.openQuestion(s, 'countdownDone', 0, now);
          break;
        case 'lock':
          s = await this.lockQuestion(s, now);
          break;
        case 'reveal':
          if (s.status === 'QUESTION_OPEN') s = await this.lockQuestion(s, now, false);
          s = await this.transition(s, 'reveal', 'game:reveal', {});
          break;
        case 'leaderboard':
          if (s.settings.hideIntermediateLeaderboard) throw new AppError('LEADERBOARD_HIDDEN');
          s = await this.transition(s, 'leaderboard', 'game:leaderboard', {});
          break;
        case 'next': {
          const isLast = (s.currentIndex ?? -1) >= s.questionOrder.length - 1;
          const to = nextStatus(s.status, 'next', { isLastQuestion: isLast });
          s =
            to === 'FINISHED'
              ? await this.finish(s, now)
              : await this.openQuestion(s, 'next', (s.currentIndex ?? -1) + 1, now);
          break;
        }
        case 'end':
          if (s.status === 'LOBBY') {
            s = await this.transition(s, 'cancel', 'game:cancelled', { endedAt: now, pin: null });
          } else {
            if (s.status === 'QUESTION_OPEN') s = await this.lockQuestion(s, now, false);
            s = await this.finish(s, now);
          }
          break;
      }
      return s;
    });
    this.schedule(result);
    await this.broadcast(
      sessionId,
      EVENT_FOR_STATUS[result.status] ?? SERVER_EVENTS.snapshot,
      result,
    );
    const out = { seq: result.stateVersion, status: result.status };
    if (opts.eventId) {
      await this.ctx.redis
        .set(keys.hostCmd(opts.eventId), JSON.stringify(out), 'EX', 3600)
        .catch(() => undefined);
    }
    this.ctx.metrics.inc('azhoot_transitions_total', { command });
    return out;
  }

  /** Aplica uma transição com checagem otimista e registra SessionEvent. */
  private async transition(
    s: ParsedSession,
    action: GameAction,
    eventType: string,
    data: Prisma.GameSessionUpdateManyMutationInput,
    extra?: (tx: Prisma.TransactionClient) => Promise<void>,
    payload: Record<string, unknown> = {},
  ): Promise<ParsedSession> {
    const to = nextStatus(s.status, action, {
      isLastQuestion: (s.currentIndex ?? -1) >= s.questionOrder.length - 1,
    });
    const seq = s.stateVersion + 1;
    const updated = await this.ctx.prisma.$transaction(async (tx) => {
      const res = await tx.gameSession.updateMany({
        where: { id: s.id, stateVersion: s.stateVersion },
        data: { ...data, status: to, stateVersion: seq },
      });
      if (res.count !== 1) throw new AppError('CONFLICT');
      await tx.sessionEvent.create({
        data: {
          gameSessionId: s.id,
          sequence: seq,
          type: eventType,
          payload: { from: s.status, to, ...payload } as object,
        },
      });
      if (extra) await extra(tx);
      return tx.gameSession.findUniqueOrThrow({ where: { id: s.id } });
    });
    this.ctx.logger.info({ sessionId: s.id, from: s.status, to, seq }, 'transição de sessão');
    return parseSession(updated);
  }

  private async openQuestion(s: ParsedSession, action: GameAction, index: number, now: Date) {
    const qid = s.questionOrder[index];
    if (!qid) throw new AppError('INVALID_TRANSITION');
    const version = await getVersion(this.ctx, s.quizVersionId);
    const q = version.questions.get(qid);
    if (!q) throw new AppError('INVALID_TRANSITION');
    return this.transition(
      s,
      action,
      'game:question-opened',
      {
        currentQuestionPosition: index,
        questionOpenedAt: now,
        questionClosesAt: new Date(now.getTime() + q.durationSeconds * 1000),
        countdownEndsAt: null,
      },
      undefined,
      { questionId: qid, index },
    );
  }

  private async lockQuestion(s: ParsedSession, now: Date, _broadcast = true) {
    const closesAt = s.questionClosesAt && s.questionClosesAt < now ? s.questionClosesAt : now;
    return this.transition(s, 'lock', 'game:question-locked', { questionClosesAt: closesAt });
  }

  private async finish(s: ParsedSession, now: Date) {
    return this.transition(
      s,
      'finish',
      'game:finished',
      { endedAt: now, pin: null, countdownEndsAt: null },
      async (tx) => {
        const participants = await tx.participant.findMany({
          where: { gameSessionId: s.id, status: { in: ['ACTIVE', 'DISCONNECTED'] } },
          select: { id: true, totalScore: true, correctCount: true, totalResponseTimeMs: true },
        });
        const ranked = rankParticipants(participants);
        for (const p of ranked) {
          await tx.participant.update({ where: { id: p.id }, data: { finalRank: p.rank } });
        }
      },
    );
  }

  /* ---------------------------------------------------------------- */
  /* Timers autoritativos                                              */
  /* ---------------------------------------------------------------- */

  schedule(s: ParsedSession) {
    this.setRuntime(s);
    const existing = this.timers.get(s.id);
    if (existing) clearTimeout(existing);
    this.timers.delete(s.id);
    if (this.stopped) return;
    let at: Date | null = null;
    let cmd: 'countdownDone' | 'lock' | null = null;
    if (s.status === 'COUNTDOWN' && s.countdownEndsAt) {
      at = s.countdownEndsAt;
      cmd = 'countdownDone';
    } else if (s.status === 'QUESTION_OPEN' && s.questionClosesAt) {
      at = s.questionClosesAt;
      cmd = 'lock';
    }
    if (!at || !cmd) return;
    const delay = Math.max(0, at.getTime() - Date.now() + TIMER_GRACE_MS);
    const expectedSeq = s.stateVersion;
    const t = setTimeout(() => {
      this.timers.delete(s.id);
      this.command(s.id, cmd, { expectedSeq }).catch((err) => {
        if (
          err instanceof AppError &&
          (err.code === 'CONFLICT' || err.code === 'INVALID_TRANSITION')
        )
          return;
        this.ctx.logger.error({ err, sessionId: s.id, cmd }, 'falha no timer da sessão');
      });
    }, delay);
    t.unref?.();
    this.timers.set(s.id, t);
  }

  /** Após reinício: reagenda prazos a partir dos timestamps persistidos. */
  async recover() {
    const active = await this.ctx.prisma.gameSession.findMany({
      where: { status: { in: ['COUNTDOWN', 'QUESTION_OPEN'] } },
    });
    for (const row of active) this.schedule(parseSession(row));
    if (active.length) this.ctx.logger.info({ count: active.length }, 'sessões ativas recuperadas');
    return active.length;
  }

  /** Encerra sessões esquecidas (ativas há mais de `maxAgeHours`). */
  async expireStale(maxAgeHours = 24) {
    const cutoff = new Date(Date.now() - maxAgeHours * 3600_000);
    const stale = await this.ctx.prisma.gameSession.findMany({
      where: {
        status: {
          in: ['LOBBY', 'COUNTDOWN', 'QUESTION_OPEN', 'QUESTION_LOCKED', 'REVEAL', 'LEADERBOARD'],
        },
        createdAt: { lt: cutoff },
      },
      select: { id: true },
    });
    for (const { id } of stale) {
      await this.command(id, 'end').catch((err) =>
        this.ctx.logger.warn({ err, sessionId: id }, 'falha ao expirar sessão'),
      );
    }
    return stale.length;
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    for (const t of this.progressTimers.values()) clearTimeout(t);
    this.timers.clear();
    this.progressTimers.clear();
  }

  /* ---------------------------------------------------------------- */
  /* Participantes                                                     */
  /* ---------------------------------------------------------------- */

  async join(pin: string, rawNickname: string) {
    const nickname = cleanNickname(rawNickname);
    const normalized = normalizeNickname(nickname);
    const settings = await getSettings(this.ctx);
    const token = randomToken(32);
    const tokenHash = hashToken(token, this.ctx.env.SESSION_SECRET);
    const expiresAt = new Date(Date.now() + this.ctx.env.PARTICIPANT_TOKEN_TTL_HOURS * 3600_000);

    const found = await this.ctx.prisma.gameSession.findFirst({
      where: { pin, status: { notIn: ['FINISHED', 'CANCELLED'] } },
      select: { id: true },
    });
    if (!found) throw new AppError('PIN_INVALID');

    try {
      const participant = await this.ctx.prisma.$transaction(async (tx) => {
        // Serializa entradas da mesma sala para respeitar o limite de participantes.
        const rows = await tx.$queryRaw<{ status: string; settings: unknown }[]>`
          SELECT status, settings FROM "GameSession" WHERE id = ${found.id}::uuid FOR UPDATE`;
        const row = rows[0];
        if (!row || row.status === 'FINISHED' || row.status === 'CANCELLED')
          throw new AppError('PIN_INVALID');
        const s = parseSession({
          ...(await tx.gameSession.findUniqueOrThrow({ where: { id: found.id } })),
        });
        if (s.status !== 'LOBBY' && !s.settings.allowLateJoin)
          throw new AppError('SESSION_STARTED');
        const count = await tx.participant.count({
          where: { gameSessionId: s.id, status: { in: ['ACTIVE', 'DISCONNECTED'] } },
        });
        if (count >= s.settings.maxParticipants) throw new AppError('SESSION_FULL');
        if (
          s.settings.nicknameModeration &&
          nicknameMatchesBlocklist(nickname, settings.nicknameBlocklist)
        ) {
          throw new AppError('NICKNAME_BLOCKED');
        }
        const banned = await tx.sessionBan.findFirst({
          where: { gameSessionId: s.id, normalizedNickname: normalized },
        });
        if (banned) throw new AppError('NICKNAME_BLOCKED');
        return tx.participant.create({
          data: {
            gameSessionId: s.id,
            nickname,
            normalizedNickname: normalized,
            sessionTokenHash: tokenHash,
            tokenExpiresAt: expiresAt,
            status: 'DISCONNECTED',
          },
        });
      });
      this.ctx.metrics.inc('azhoot_participants_joined_total');
      return {
        sessionId: found.id,
        participantId: participant.id,
        nickname,
        token,
        expiresAt: expiresAt.toISOString(),
      };
    } catch (err) {
      if (isUniqueViolation(err, 'normalizedNickname') || isUniqueViolation(err, 'gameSessionId')) {
        throw new AppError('NICKNAME_TAKEN');
      }
      throw err;
    }
  }

  /** Valida o token do participante para a sessão informada. */
  async authenticateParticipant(sessionId: string, token: string) {
    const p = await this.ctx.prisma.participant.findUnique({
      where: { sessionTokenHash: hashToken(token, this.ctx.env.SESSION_SECRET) },
    });
    if (!p || p.gameSessionId !== sessionId) throw new AppError('PARTICIPANT_TOKEN_INVALID');
    if (p.status === 'REMOVED' || p.status === 'BLOCKED') throw new AppError('PARTICIPANT_REMOVED');
    if (p.tokenExpiresAt < new Date()) throw new AppError('PARTICIPANT_TOKEN_INVALID');
    return p;
  }

  /** Presença: conta conexões por participante (várias abas) no Redis. */
  async participantConnected(sessionId: string, participantId: string) {
    const n = await this.ctx.redis.hincrby(keys.presence(sessionId), participantId, 1);
    await this.ctx.redis.expire(keys.presence(sessionId), SNAPSHOT_TTL_SECONDS);
    this.ctx.metrics.addGauge('azhoot_participants_connected', 1);
    if (n === 1) {
      const res = await this.ctx.prisma.participant.updateMany({
        where: { id: participantId, status: { in: ['ACTIVE', 'DISCONNECTED'] } },
        data: { status: 'ACTIVE', lastSeenAt: new Date() },
      });
      if (res.count === 1)
        await this.emitPresence(sessionId, participantId, SERVER_EVENTS.participantJoined);
    }
  }

  async participantDisconnected(sessionId: string, participantId: string) {
    const n = await this.ctx.redis.hincrby(keys.presence(sessionId), participantId, -1);
    this.ctx.metrics.addGauge('azhoot_participants_connected', -1);
    if (n <= 0) {
      await this.ctx.redis.hdel(keys.presence(sessionId), participantId);
      const res = await this.ctx.prisma.participant.updateMany({
        where: { id: participantId, status: 'ACTIVE' },
        data: { status: 'DISCONNECTED', lastSeenAt: new Date() },
      });
      if (res.count === 1) {
        await this.emitPresence(
          sessionId,
          participantId,
          SERVER_EVENTS.participantLeft,
          'disconnected',
        );
        this.scheduleProgress(sessionId);
      }
    }
  }

  private async emitPresence(
    sessionId: string,
    participantId: string,
    event: ServerEventName,
    reason?: ParticipantPresencePayload['reason'],
  ) {
    const io = this.ctx.io;
    if (!io) return;
    const [p, count, s] = await Promise.all([
      this.ctx.prisma.participant.findUnique({
        where: { id: participantId },
        select: { id: true, nickname: true, status: true },
      }),
      this.ctx.prisma.participant.count({
        where: { gameSessionId: sessionId, status: { in: ['ACTIVE', 'DISCONNECTED'] } },
      }),
      this.ctx.prisma.gameSession.findUnique({
        where: { id: sessionId },
        select: { stateVersion: true },
      }),
    ]);
    if (!p) return;
    const payload: ParticipantPresencePayload = {
      participant: { id: p.id, nickname: p.nickname, status: p.status },
      participantCount: count,
      ...(reason ? { reason } : {}),
    };
    io.to(rooms.all(sessionId)).emit(
      event,
      this.envelope(sessionId, s?.stateVersion ?? 0, payload),
    );
  }

  async removeParticipant(
    sessionId: string,
    participantId: string,
    block: boolean,
    actorId: string,
  ) {
    const p = await this.ctx.prisma.participant.findUnique({ where: { id: participantId } });
    if (!p || p.gameSessionId !== sessionId) throw new AppError('NOT_FOUND');
    if (p.status === 'REMOVED' || p.status === 'BLOCKED') return;
    await this.ctx.prisma.$transaction(async (tx) => {
      await tx.participant.update({
        where: { id: p.id },
        data: { status: block ? 'BLOCKED' : 'REMOVED' },
      });
      await tx.sessionBan.create({
        data: {
          gameSessionId: sessionId,
          tokenHash: p.sessionTokenHash,
          normalizedNickname: block ? p.normalizedNickname : null,
        },
      });
    });
    await this.ctx.redis.hdel(keys.presence(sessionId), participantId);
    const io = this.ctx.io;
    if (io) {
      const s = await this.loadSession(sessionId);
      io.to(rooms.participant(p.id)).emit(
        SERVER_EVENTS.error,
        this.envelope(sessionId, s.stateVersion, {
          code: 'PARTICIPANT_REMOVED',
          message: 'Você foi removido desta sala pelo apresentador.',
        }),
      );
      io.in(rooms.participant(p.id)).disconnectSockets(true);
    }
    await this.emitPresence(
      sessionId,
      p.id,
      SERVER_EVENTS.participantLeft,
      block ? 'blocked' : 'removed',
    );
    this.ctx.logger.info({ sessionId, participantId, block, actorId }, 'participante removido');
    this.scheduleProgress(sessionId);
  }

  /* ---------------------------------------------------------------- */
  /* Respostas                                                         */
  /* ---------------------------------------------------------------- */

  /** Estado mínimo da pergunta atual, em memória (atualizado a cada transição nesta instância). */
  private runtime = new Map<
    string,
    {
      stateVersion: number;
      quizVersionId: string;
      currentIndex: number | null;
      questionId: string | null;
      openedAt: Date | null;
    }
  >();

  private setRuntime(s: ParsedSession) {
    if (isTerminal(s.status)) {
      this.runtime.delete(s.id);
      return;
    }
    this.runtime.set(s.id, {
      stateVersion: s.stateVersion,
      quizVersionId: s.quizVersionId,
      currentIndex: s.currentIndex,
      questionId: currentQuestionId(s),
      openedAt: s.questionOpenedAt,
    });
  }

  private async getRuntime(sessionId: string, refresh = false) {
    const cached = this.runtime.get(sessionId);
    if (cached && !refresh) return cached;
    const s = await this.loadSession(sessionId);
    this.setRuntime(s);
    return this.runtime.get(sessionId) ?? null;
  }

  /**
   * Registra resposta de forma idempotente, em um único comando SQL atômico:
   * o INSERT só acontece se a sessão ainda estiver com a pergunta aberta e dentro do prazo
   * (linha da sessão travada com FOR SHARE — o fechamento espera as respostas em curso).
   * `receivedAt` é a hora do servidor na recepção do evento.
   */
  async submitAnswer(
    sessionId: string,
    participantId: string,
    input: { answerId: string; questionId: string; optionIds: string[] },
    receivedAt: Date,
    attempt = 0,
  ): Promise<AnswerResult> {
    const rt = await this.getRuntime(sessionId, attempt > 0);
    if (!rt) throw new AppError('QUESTION_CLOSED');
    if (rt.questionId !== input.questionId || !rt.openedAt || rt.currentIndex == null) {
      if (attempt === 0) return this.submitAnswer(sessionId, participantId, input, receivedAt, 1);
      return this.duplicateOr(input, participantId, new AppError('QUESTION_MISMATCH'));
    }
    const version = await getVersion(this.ctx, rt.quizVersionId);
    const q = version.questions.get(input.questionId);
    if (!q) throw new AppError('ANSWER_INVALID');
    const selected = [...new Set(input.optionIds)].sort();
    if (selected.some((id) => !q.optionIds.has(id))) throw new AppError('ANSWER_INVALID');
    if (q.type !== 'MULTIPLE_CHOICE' && selected.length !== 1) throw new AppError('ANSWER_INVALID');

    const isCorrect = evaluateAnswer(q.type, q.correctOptionIds, selected);
    const openedAt = rt.openedAt.getTime();
    const closesAt = openedAt + q.durationSeconds * 1000;
    const responseTimeMs = Math.max(0, receivedAt.getTime() - openedAt);
    const scoreAwarded = computeScore({
      basePoints: q.basePoints,
      isCorrect: isCorrect === true,
      openedAt,
      closesAt,
      receivedAt: receivedAt.getTime(),
    });
    const correctInc = isCorrect ? 1 : 0;
    const timeInc = isCorrect ? responseTimeMs : 0;

    let inserted: number;
    try {
      const rows = await this.ctx.prisma.$queryRaw<{ inserted: number }[]>`
        WITH ok AS (
          SELECT 1 FROM "GameSession"
          WHERE id = ${sessionId}::uuid
            AND status = 'QUESTION_OPEN'
            AND "currentQuestionPosition" = ${rt.currentIndex}
            AND "questionClosesAt" >= ${receivedAt}
          FOR SHARE
        ), ins AS (
          INSERT INTO "Answer" (id, "clientAnswerId", "gameSessionId", "participantId", "questionId", "selectedOptionIds", "isCorrect", "scoreAwarded", "responseTimeMs", "receivedAt")
          SELECT ${randomUUID()}::uuid, ${input.answerId}::uuid, ${sessionId}::uuid, ${participantId}::uuid, ${q.id}::uuid, ${selected}::uuid[], ${isCorrect}, ${scoreAwarded}, ${responseTimeMs}, ${receivedAt}
          FROM ok
          RETURNING id
        ), upd AS (
          UPDATE "Participant"
          SET "totalScore" = "totalScore" + ${scoreAwarded},
              "correctCount" = "correctCount" + ${correctInc},
              "totalResponseTimeMs" = "totalResponseTimeMs" + ${timeInc},
              "lastSeenAt" = ${receivedAt}
          WHERE id = ${participantId}::uuid AND EXISTS (SELECT 1 FROM ins)
          RETURNING id
        )
        SELECT (SELECT count(*) FROM ins)::int AS inserted, (SELECT count(*) FROM upd)::int AS updated`;
      inserted = Number(rows[0]?.inserted ?? 0);
    } catch (err) {
      const msg = `${(err as Error).message ?? ''} ${JSON.stringify((err as { meta?: unknown }).meta ?? {})}`;
      if (/23505|unique/i.test(msg) || isUniqueViolation(err)) {
        if (/clientAnswerId/.test(msg))
          return this.duplicateOr(input, participantId, new AppError('ALREADY_ANSWERED'));
        this.ctx.metrics.inc('azhoot_answers_total', { result: 'already_answered' });
        return this.duplicateOr(input, participantId, new AppError('ALREADY_ANSWERED'));
      }
      throw err;
    }

    if (inserted === 0) {
      // Fora do prazo, pergunta mudou, ou cache desatualizado (outra instância): confirma no banco.
      if (attempt === 0) {
        const fresh = await this.getRuntime(sessionId, true);
        if (
          fresh &&
          fresh.questionId === input.questionId &&
          fresh.stateVersion !== rt.stateVersion
        ) {
          return this.submitAnswer(sessionId, participantId, input, receivedAt, 1);
        }
      }
      this.ctx.metrics.inc('azhoot_answers_total', { result: 'question_closed' });
      return this.duplicateOr(input, participantId, new AppError('QUESTION_CLOSED'));
    }

    this.ctx.metrics.inc('azhoot_answers_total', { result: 'accepted' });
    const result: AnswerResult = {
      duplicate: false,
      answerId: input.answerId,
      questionId: q.id,
      selectedOptionIds: selected,
    };
    this.notifyAnswerAccepted(sessionId, participantId, result);
    this.scheduleProgress(sessionId);
    return result;
  }

  /** Se já existe resposta com este answerId, devolve o original (idempotência); senão lança `err`. */
  private async duplicateOr(
    input: { answerId: string },
    participantId: string,
    err: AppError,
  ): Promise<AnswerResult> {
    const existing = await this.ctx.prisma.answer.findUnique({
      where: { clientAnswerId: input.answerId },
    });
    if (existing) {
      if (existing.participantId !== participantId) throw new AppError('ANSWER_INVALID');
      this.ctx.metrics.inc('azhoot_answers_total', { result: 'duplicate' });
      return {
        duplicate: true,
        answerId: existing.clientAnswerId,
        questionId: existing.questionId,
        selectedOptionIds: existing.selectedOptionIds,
      };
    }
    throw err;
  }

  private notifyAnswerAccepted(sessionId: string, participantId: string, r: AnswerResult) {
    const io = this.ctx.io;
    if (!io) return;
    const payload: AnswerAcceptedPayload = {
      questionId: r.questionId,
      answerId: r.answerId,
      selectedOptionIds: r.selectedOptionIds,
      duplicate: r.duplicate,
    };
    io.to(rooms.participant(participantId)).emit(
      SERVER_EVENTS.answerAccepted,
      this.envelope(sessionId, 0, payload),
    );
  }

  /** Envia progresso ao host (limitado) e fecha a pergunta quando todos os conectados responderam. */
  scheduleProgress(sessionId: string) {
    if (this.progressTimers.has(sessionId) || this.stopped) return;
    const t = setTimeout(() => {
      this.progressTimers.delete(sessionId);
      this.flushProgress(sessionId).catch((err) =>
        this.ctx.logger.warn({ err, sessionId }, 'falha ao enviar progresso'),
      );
    }, PROGRESS_THROTTLE_MS);
    t.unref?.();
    this.progressTimers.set(sessionId, t);
  }

  private async flushProgress(sessionId: string) {
    const s = await this.loadSession(sessionId);
    const qid = currentQuestionId(s);
    if (s.status !== 'QUESTION_OPEN' || !qid) return;
    const [answered, active, total] = await Promise.all([
      this.ctx.prisma.answer.count({ where: { gameSessionId: sessionId, questionId: qid } }),
      this.ctx.prisma.participant.findMany({
        where: { gameSessionId: sessionId, status: 'ACTIVE' },
        select: { id: true },
      }),
      this.ctx.prisma.participant.count({
        where: { gameSessionId: sessionId, status: { in: ['ACTIVE', 'DISCONNECTED'] } },
      }),
    ]);
    const payload: AnswersProgressPayload = {
      questionId: qid,
      answeredCount: answered,
      participantCount: total,
    };
    this.ctx.io
      ?.to(rooms.host(sessionId))
      .emit(SERVER_EVENTS.answersProgress, this.envelope(sessionId, s.stateVersion, payload));
    if (active.length > 0) {
      const activeAnswered = await this.ctx.prisma.answer.count({
        where: {
          gameSessionId: sessionId,
          questionId: qid,
          participantId: { in: active.map((a) => a.id) },
        },
      });
      if (activeAnswered >= active.length) {
        await this.command(sessionId, 'lock', { expectedSeq: s.stateVersion }).catch((err) => {
          if (!(err instanceof AppError)) throw err;
        });
      }
    }
  }

  isActive(status: string) {
    return !isTerminal(status as ParsedSession['status']);
  }
}
