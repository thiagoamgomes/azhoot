/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origem da API em produção com subdomínio (ex.: https://api.azhoot.com.br). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
