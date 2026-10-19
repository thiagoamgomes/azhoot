import type { JoinResponse } from '@azhoot/contracts';

/**
 * Token do participante fica no sessionStorage: sobrevive a atualizar a página,
 * mas não vaza para outras abas ou após fechar o navegador.
 */
const key = (sessionId: string) => `azhoot:participant:${sessionId}`;

export function saveParticipant(join: JoinResponse) {
  sessionStorage.setItem(key(join.sessionId), JSON.stringify(join));
}

export function loadParticipant(sessionId: string): JoinResponse | null {
  try {
    const raw = sessionStorage.getItem(key(sessionId));
    if (!raw) return null;
    const data = JSON.parse(raw) as JoinResponse;
    if (new Date(data.expiresAt) < new Date()) {
      sessionStorage.removeItem(key(sessionId));
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function clearParticipant(sessionId: string) {
  sessionStorage.removeItem(key(sessionId));
}
