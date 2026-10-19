/** Constantes de domínio compartilhadas entre API e web. */

export const CONTRACT_VERSION = 1 as const;

export const USER_ROLES = ['OWNER', 'ADMIN', 'PRESENTER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const QUIZ_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type QuizStatus = (typeof QUIZ_STATUSES)[number];

export const QUESTION_TYPES = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'POLL'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  SINGLE_CHOICE: 'Única escolha',
  MULTIPLE_CHOICE: 'Múltipla escolha',
  TRUE_FALSE: 'Verdadeiro ou falso',
  POLL: 'Enquete',
};

export const QUESTION_DURATIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120] as const;
export type QuestionDuration = (typeof QUESTION_DURATIONS)[number];

export const QUESTION_POINTS = [0, 500, 1000, 2000] as const;
export type QuestionPoints = (typeof QUESTION_POINTS)[number];

export const LIMITS = {
  promptMin: 3,
  promptMax: 300,
  optionTextMax: 120,
  optionsMin: 2,
  optionsMax: 6,
  explanationMax: 500,
  quizTitleMin: 3,
  quizTitleMax: 120,
  quizDescriptionMax: 1000,
  quizCategoryMax: 60,
  questionsMax: 100,
  nicknameMin: 2,
  nicknameMax: 24,
  maxParticipantsPerSession: 200,
  uploadMaxMb: 5,
} as const;

export const GAME_STATUSES = [
  'LOBBY',
  'COUNTDOWN',
  'QUESTION_OPEN',
  'QUESTION_LOCKED',
  'REVEAL',
  'LEADERBOARD',
  'FINISHED',
  'CANCELLED',
] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export const ACTIVE_GAME_STATUSES: readonly GameStatus[] = [
  'LOBBY',
  'COUNTDOWN',
  'QUESTION_OPEN',
  'QUESTION_LOCKED',
  'REVEAL',
  'LEADERBOARD',
];

export const PARTICIPANT_STATUSES = ['ACTIVE', 'DISCONNECTED', 'REMOVED', 'BLOCKED'] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

/** Duração da contagem regressiva antes da primeira pergunta. */
export const COUNTDOWN_SECONDS = 5;

export const GAME_STATUS_LABELS: Record<GameStatus, string> = {
  LOBBY: 'Aguardando participantes',
  COUNTDOWN: 'Contagem regressiva',
  QUESTION_OPEN: 'Pergunta aberta',
  QUESTION_LOCKED: 'Respostas encerradas',
  REVEAL: 'Revelação',
  LEADERBOARD: 'Classificação',
  FINISHED: 'Encerrada',
  CANCELLED: 'Cancelada',
};
