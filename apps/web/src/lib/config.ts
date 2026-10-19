/**
 * Origem da API. Vazio = mesma origem da SPA (dev com proxy do Vite, ou deploy
 * de origem única). Em produção com API em subdomínio, defina VITE_API_URL
 * (ex.: https://api.azhoot.com.br) no build.
 */
export const API_ORIGIN = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/**
 * Resolve uma URL servida pela API (ex.: imagens em /uploads) contra a origem
 * da API. Mantém URLs absolutas e data URLs intactas.
 */
export function assetUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^(https?:)?\/\//.test(path) || path.startsWith('data:')) return path;
  return `${API_ORIGIN}${path}`;
}
