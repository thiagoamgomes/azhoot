import pino from 'pino';

export type Logger = pino.Logger;

/** Chaves sensíveis nunca gravadas em log. */
const REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.csrfToken',
  '*.optionIds',
  '*.apiKey',
  '*.apiKeyEnc',
  '*.webhookToken',
  '*.webhookTokenEnc',
  '*.temporaryPassword',
  '*.secret',
  'password',
  'token',
  'temporaryPassword',
];

export function createLogger(level: string, pretty = false): Logger {
  return pino({
    level,
    base: { service: 'azhoot-api' },
    redact: { paths: REDACT, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
          },
        }
      : {}),
  });
}
