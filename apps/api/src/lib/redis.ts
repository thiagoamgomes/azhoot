import { Redis } from 'ioredis';

export type RedisClient = Redis;

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 3, enableOfflineQueue: true, lazyConnect: false });
}

export const keys = {
  rate: (bucket: string, id: string) => `azh:rl:${bucket}:${id}`,
  pinFail: (ip: string) => `azh:pinfail:${ip}`,
  snapshot: (sessionId: string) => `azh:snap:${sessionId}`,
  presence: (sessionId: string) => `azh:presence:${sessionId}`,
  hostCmd: (eventId: string) => `azh:hostcmd:${eventId}`,
  lock: (sessionId: string) => `azh:lock:${sessionId}`,
  accountLock: (accountId: string) => `azh:lock:account:${accountId}`,
  abuse: (socketKey: string) => `azh:abuse:${socketKey}`,
};
