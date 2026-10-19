import { errorMessage, type ApiErrorBody, type ErrorCode } from '@azhoot/contracts';
import { API_ORIGIN } from './config';

const BASE = `${API_ORIGIN}/api/v1`;

let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
    public readonly requestId?: string,
  ) {
    super(message);
  }

  /** Erros de campo retornados por VALIDATION_FAILED/NICKNAME_INVALID. */
  get fields(): Record<string, string> {
    return (this.details.fields as Record<string, string>) ?? {};
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
  raw?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body || opts.formData ? 'POST' : 'GET');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(
      'NETWORK_ERROR',
      'Sem conexão com o servidor. Verifique sua internet e tente novamente.',
      0,
    );
  }
  if (opts.raw && res.ok) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const body = data as ApiErrorBody | undefined;
    const code = body?.error?.code ?? 'INTERNAL_ERROR';
    throw new ApiError(
      code,
      body?.error?.message ?? errorMessage(code),
      res.status,
      body?.error?.details ?? {},
      body?.error?.requestId,
    );
  }
  return data as T;
}

/** Baixa um arquivo autenticado (exportação de relatório). */
export async function download(path: string, fallbackName: string) {
  const res = await api<Response>(path, { raw: true });
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Ocorreu um erro inesperado.';
}
