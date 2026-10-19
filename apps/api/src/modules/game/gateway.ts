import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import cookie from 'cookie-parser';
import { Server, type Socket } from 'socket.io';
import { type z } from 'zod';
import {
  CLIENT_EVENTS,
  CLIENT_PAYLOAD_SCHEMAS,
  CONTRACT_VERSION,
  ERROR_CODES,
  SERVER_EVENTS,
  clientEnvelopeSchema,
  type Ack,
  type AuthUser,
  type ClientEventName,
} from '@azhoot/contracts';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { hit } from '../../lib/rateLimit';
import { cookieName } from '../auth/middleware';
import { resolveAdminSession, toAuthUser } from '../auth/service';
import { rooms, type GameEngine, type HostCommand } from './engine';

interface SocketData {
  user?: AuthUser;
  participant?: { id: string; sessionId: string };
  hostSessions: Set<string>;
  events: number[];
  violations: number;
}

type GameSocket = Socket & { data: SocketData };

const PARTICIPANT_EVENTS_PER_5S = 25;
const HOST_EVENTS_PER_5S = 60;
const MAX_VIOLATIONS = 5;

const HOST_COMMANDS: Record<string, HostCommand> = {
  [CLIENT_EVENTS.hostStart]: 'start',
  [CLIENT_EVENTS.hostLockQuestion]: 'lock',
  [CLIENT_EVENTS.hostReveal]: 'reveal',
  [CLIENT_EVENTS.hostShowLeaderboard]: 'leaderboard',
  [CLIENT_EVENTS.hostNextQuestion]: 'next',
  [CLIENT_EVENTS.hostEnd]: 'end',
};

function toAck(err: unknown): Ack<never> {
  if (err instanceof AppError)
    return { ok: false, error: { code: err.code, message: err.message } };
  return { ok: false, error: { code: 'INTERNAL_ERROR', message: ERROR_CODES.INTERNAL_ERROR } };
}

/** Gateway Socket.IO no mesmo servidor HTTP do Express. Namespace `/game`. */
export async function attachGateway(ctx: AppContext, http: HttpServer, engine: GameEngine) {
  const io = new Server(http, {
    path: '/socket.io',
    serveClient: false,
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 20000,
    pingTimeout: 20000,
    connectionStateRecovery: undefined,
    cors: { origin: ctx.env.WEB_ORIGIN, credentials: true },
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      // Sem Origin (ex.: cliente de teste Node) é aceito; navegadores sempre enviam.
      cb(null, !origin || ctx.env.WEB_ORIGIN.includes(origin));
    },
  });

  if (ctx.env.SOCKET_REDIS_ADAPTER) {
    const pub = ctx.redis.duplicate();
    const sub = ctx.redis.duplicate();
    io.adapter(createAdapter(pub, sub));
  }

  const nsp = io.of('/game');
  const parseCookies = cookie();

  // Handshake: limite por IP e leitura opcional do cookie de administrador.
  nsp.use(async (socket, next) => {
    try {
      const ip = socket.handshake.address;
      const r = await hit(ctx.redis, 'ws-handshake', ip, 600, 60);
      if (!r.allowed) return next(new Error('RATE_LIMITED'));
      const req = socket.request as Parameters<typeof parseCookies>[0];
      await new Promise<void>((resolve) => parseCookies(req, {} as never, () => resolve()));
      const token = (req as unknown as { cookies?: Record<string, string> }).cookies?.[
        cookieName(ctx)
      ];
      const session = token ? await resolveAdminSession(ctx, token) : null;
      const data = socket.data as SocketData;
      data.user = session ? toAuthUser(session.user) : undefined;
      data.hostSessions = new Set();
      data.events = [];
      data.violations = 0;
      next();
    } catch (err) {
      ctx.logger.warn({ err }, 'falha no handshake do socket');
      next(new Error('INTERNAL_ERROR'));
    }
  });

  nsp.on('connection', (raw) => {
    const socket = raw as unknown as GameSocket;
    ctx.metrics.addGauge('azhoot_socket_connections', 1);

    const limited = (): boolean => {
      const now = Date.now();
      const d = socket.data;
      d.events = d.events.filter((t: number) => now - t < 5000);
      d.events.push(now);
      const limit = d.user ? HOST_EVENTS_PER_5S : PARTICIPANT_EVENTS_PER_5S;
      if (d.events.length > limit) {
        d.violations++;
        ctx.metrics.inc('azhoot_socket_rate_limited_total');
        if (d.violations >= MAX_VIOLATIONS) {
          ctx.logger.warn(
            { socketId: socket.id, ip: socket.handshake.address },
            'socket desconectado por abuso',
          );
          socket.disconnect(true);
        }
        return true;
      }
      return false;
    };

    /** Registra handler com validação do envelope + payload e resposta via ack. */
    const on = <E extends ClientEventName>(
      event: E,
      handler: (
        env: { eventId: string; sessionId: string; payload: never },
        receivedAt: Date,
      ) => Promise<unknown>,
    ) => {
      const schema =
        event === CLIENT_EVENTS.clockSync
          ? null
          : clientEnvelopeSchema(
              CLIENT_PAYLOAD_SCHEMAS[event as keyof typeof CLIENT_PAYLOAD_SCHEMAS] as z.ZodType,
            );
      socket.on(event as string, async (body: unknown, ack?: (a: Ack) => void) => {
        const receivedAt = new Date();
        const started = performance.now();
        const reply = typeof ack === 'function' ? ack : () => undefined;
        if (limited())
          return reply({
            ok: false,
            error: { code: 'RATE_LIMITED', message: ERROR_CODES.RATE_LIMITED },
          });
        try {
          if (!schema) return reply({ ok: true, data: await handler(body as never, receivedAt) });
          const parsed = schema.safeParse(body);
          if (!parsed.success) throw new AppError('VALIDATION_FAILED');
          const data = await handler(parsed.data as never, receivedAt);
          reply({ ok: true, data });
        } catch (err) {
          if (!(err instanceof AppError))
            ctx.logger.error({ err, event }, 'erro em evento de socket');
          reply(toAck(err));
        } finally {
          ctx.metrics.observe('azhoot_socket_event_ms', performance.now() - started, { event });
        }
      });
    };

    /* ----------------------------- relógio ----------------------------- */
    on(CLIENT_EVENTS.clockSync, async () => ({ serverTime: new Date().toISOString() }));

    /* --------------------------- participante --------------------------- */
    const attachParticipant = async (sessionId: string, token: string) => {
      const p = await engine.authenticateParticipant(sessionId, token);
      const prev = socket.data.participant;
      if (prev && prev.id !== p.id) throw new AppError('FORBIDDEN');
      if (!prev) {
        socket.data.participant = { id: p.id, sessionId };
        await socket.join([rooms.all(sessionId), rooms.participant(p.id)]);
        await engine.participantConnected(sessionId, p.id);
      }
      return engine.snapshotFor(sessionId, 'participant', p.id);
    };

    on(CLIENT_EVENTS.participantJoin, async (env) => {
      const payload = env.payload as { token: string };
      const snap = await attachParticipant(env.sessionId, payload.token);
      socket.emit(SERVER_EVENTS.snapshot, engine.envelope(env.sessionId, snap.seq, snap));
      return snap;
    });

    on(CLIENT_EVENTS.participantResume, async (env) => {
      const payload = env.payload as { token: string; lastSeq?: number };
      const snap = await attachParticipant(env.sessionId, payload.token);
      socket.emit(SERVER_EVENTS.snapshot, engine.envelope(env.sessionId, snap.seq, snap));
      return snap;
    });

    on(CLIENT_EVENTS.participantAnswer, async (env, receivedAt) => {
      const p = socket.data.participant;
      if (!p || p.sessionId !== env.sessionId) throw new AppError('PARTICIPANT_TOKEN_INVALID');
      const payload = env.payload as { answerId: string; questionId: string; optionIds: string[] };
      return engine.submitAnswer(env.sessionId, p.id, payload, receivedAt);
    });

    /* ------------------------------- host ------------------------------- */
    const assertHost = async (sessionId: string) => {
      const user = socket.data.user;
      if (!user) throw new AppError('UNAUTHENTICATED');
      const s = await engine.loadSession(sessionId);
      const accountId = (
        await ctx.prisma.gameSession.findUnique({
          where: { id: sessionId },
          select: { accountId: true },
        })
      )?.accountId;
      if (accountId !== user.accountId || (s.hostUserId !== user.id && user.role !== 'OWNER')) {
        throw new AppError('FORBIDDEN');
      }
      return { user, session: s };
    };

    on(CLIENT_EVENTS.hostJoin, async (env) => {
      await assertHost(env.sessionId);
      if (!socket.data.hostSessions.has(env.sessionId)) {
        socket.data.hostSessions.add(env.sessionId);
        await socket.join([rooms.all(env.sessionId), rooms.host(env.sessionId)]);
      }
      const snap = await engine.snapshotFor(env.sessionId, 'host');
      socket.emit(SERVER_EVENTS.snapshot, engine.envelope(env.sessionId, snap.seq, snap));
      return snap;
    });

    for (const [event, command] of Object.entries(HOST_COMMANDS)) {
      on(event as ClientEventName, async (env) => {
        const { user } = await assertHost(env.sessionId);
        const payload = env.payload as { expectedSeq?: number };
        const result = await engine.command(env.sessionId, command, {
          expectedSeq: payload.expectedSeq,
          eventId: env.eventId,
          actorId: user.id,
        });
        if (command === 'start' || command === 'end') {
          await audit(ctx, {
            actorId: user.id,
            action: command === 'start' ? 'session.started' : 'session.ended',
            entityType: 'session',
            entityId: env.sessionId,
            requestId: env.eventId,
          });
        }
        return result;
      });
    }

    on(CLIENT_EVENTS.hostRemoveParticipant, async (env) => {
      const { user } = await assertHost(env.sessionId);
      const payload = env.payload as { participantId: string; block: boolean };
      await engine.removeParticipant(env.sessionId, payload.participantId, payload.block, user.id);
      await audit(ctx, {
        actorId: user.id,
        action: 'session.participant_removed',
        entityType: 'session',
        entityId: env.sessionId,
        metadata: { participantId: payload.participantId, block: payload.block },
        requestId: env.eventId,
      });
      return { removed: true };
    });

    socket.on('disconnect', () => {
      ctx.metrics.addGauge('azhoot_socket_connections', -1);
      const p = socket.data.participant;
      if (p) {
        engine
          .participantDisconnected(p.sessionId, p.id)
          .catch((err) => ctx.logger.warn({ err }, 'falha ao registrar desconexão'));
      }
    });
  });

  ctx.io = nsp;
  ctx.logger.info({ contract: CONTRACT_VERSION }, 'gateway realtime pronto');
  return io;
}
