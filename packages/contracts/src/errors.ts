/** Códigos de erro padronizados usados por REST e Socket.IO. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'Os dados enviados são inválidos.',
  UNAUTHENTICATED: 'Faça login para continuar.',
  INVALID_CREDENTIALS: 'E-mail ou senha incorretos.',
  FORBIDDEN: 'Você não tem permissão para esta ação.',
  CSRF_INVALID: 'Sua sessão expirou. Atualize a página e tente novamente.',
  NOT_FOUND: 'Recurso não encontrado.',
  CONFLICT: 'O recurso foi alterado por outra operação. Tente novamente.',
  RATE_LIMITED: 'Muitas tentativas. Aguarde um pouco e tente novamente.',
  INTERNAL_ERROR: 'Ocorreu um erro inesperado.',
  EMAIL_IN_USE: 'Já existe um usuário com este e-mail.',
  CANNOT_MODIFY_SELF: 'Você não pode alterar seu próprio perfil ou acesso por aqui.',
  QUIZ_NOT_PUBLISHED: 'O quiz precisa estar publicado.',
  QUIZ_INVALID: 'O quiz possui problemas que impedem a publicação.',
  QUIZ_ARCHIVED: 'O quiz está arquivado.',
  QUIZ_IN_USE: 'O quiz possui sessões e não pode ser excluído. Arquive-o.',
  UPLOAD_INVALID: 'Arquivo inválido. Envie JPEG, PNG ou WebP de até 5 MB.',
  PIN_INVALID: 'PIN não encontrado ou sala encerrada.',
  SESSION_NOT_FOUND: 'Sessão não encontrada.',
  SESSION_ENDED: 'Esta sessão já foi encerrada.',
  SESSION_FULL: 'A sala está cheia.',
  SESSION_STARTED: 'A partida já começou e esta sala não permite entrada tardia.',
  SESSION_NO_QUESTIONS: 'O quiz não possui perguntas.',
  NICKNAME_INVALID: 'Apelido inválido. Use de 2 a 24 caracteres, sem símbolos especiais.',
  NICKNAME_TAKEN: 'Este apelido já está em uso na sala. Escolha outro.',
  NICKNAME_BLOCKED: 'Este apelido não é permitido.',
  PARTICIPANT_TOKEN_INVALID: 'Sua participação não é mais válida. Entre novamente.',
  PARTICIPANT_REMOVED: 'Você foi removido desta sala pelo apresentador.',
  INVALID_TRANSITION: 'Esta ação não é permitida no momento.',
  QUESTION_CLOSED: 'O tempo acabou. Sua resposta não foi registrada.',
  QUESTION_MISMATCH: 'Esta pergunta não está mais aberta.',
  ALREADY_ANSWERED: 'Você já respondeu esta pergunta.',
  ANSWER_INVALID: 'Resposta inválida para esta pergunta.',
  PLAN_LIMIT_QUIZZES:
    'Você atingiu o limite de quizzes do seu plano. Faça upgrade para criar mais.',
  PLAN_LIMIT_USERS:
    'Você atingiu o limite de usuários do seu plano. Faça upgrade para adicionar mais.',
  PLAN_INVALID: 'Plano inválido ou indisponível.',
  PLAN_SAME: 'Você já está neste plano.',
  PLAN_REMOVALS_REQUIRED: 'Selecione os itens que serão excluídos para caber no novo plano.',
  ACCOUNT_FROZEN:
    'Sua conta está congelada por falta de pagamento. Regularize o pagamento ou volte ao plano Gratuito.',
  ACCOUNT_INACTIVE: 'Esta conta está inativa. Fale com o suporte.',
  BILLING_NOT_CONFIGURED: 'Pagamentos ainda não estão configurados. Tente novamente mais tarde.',
  BILLING_PROVIDER_ERROR: 'Não foi possível falar com o provedor de pagamentos. Tente novamente.',
  BILLING_DOCUMENT_INVALID: 'Informe um CPF ou CNPJ válido.',
  NO_ACTIVE_SUBSCRIPTION: 'Não há assinatura paga ativa.',
  NO_PENDING_CHANGE: 'Não há mudança de plano agendada.',
  CHECKOUT_PENDING: 'Já existe um pagamento em aberto para este plano.',
  AFFILIATE_DISABLED: 'O modo afiliado não está ativo para sua conta.',
  WEBHOOK_UNAUTHORIZED: 'Webhook não autorizado.',
  NOT_ACCOUNT_OWNER: 'Somente o dono da conta pode fazer isso.',
  MASTER_ONLY: 'Acesso restrito ao painel master.',
  PASSWORD_CHANGE_REQUIRED: 'Troque sua senha para continuar.',
  NO_AI_CREDITS: 'Você não tem créditos de IA suficientes. Adicione mais créditos para continuar.',
  AI_NOT_CONFIGURED: 'A geração com IA ainda não está configurada. Fale com o suporte.',
  AI_FAILED: 'Não foi possível gerar as perguntas agora. Tente novamente em instantes.',
  CREDIT_PACK_INVALID: 'Pacote de créditos inválido ou indisponível.',
  ATTACHMENT_INVALID:
    'Anexo inválido. Envie PDF, DOCX, Excel (XLSX) ou imagem (PNG, JPEG, WebP) de até 15 MB.',
  ATTACHMENT_EMPTY:
    'Não consegui ler texto do documento anexado. Verifique se ele não é apenas imagem ou está protegido.',
  LEADERBOARD_HIDDEN: 'A classificação intermediária está oculta nesta sessão.',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId?: string;
    details?: Record<string, unknown>;
  };
}

export function errorMessage(code: string): string {
  return (ERROR_CODES as Record<string, string>)[code] ?? ERROR_CODES.INTERNAL_ERROR;
}
