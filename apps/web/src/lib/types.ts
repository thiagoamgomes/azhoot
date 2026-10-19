import type { QuestionType, QuizStatus, SessionSettings, UserRole } from '@azhoot/contracts';

export interface QuizListItem {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  coverImageUrl: string | null;
  status: QuizStatus;
  hasDraft: boolean;
  isPublished: boolean;
  publishedVersionNumber: number | null;
  questionCount: number;
  publishedQuestionCount: number;
  sessionCount: number;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
}

export interface EditorOption {
  id?: string;
  /** Chave estável local (para React e dnd). */
  key: string;
  text: string;
  imageUrl: string | null;
  isCorrect: boolean;
}

export interface EditorQuestion {
  id?: string;
  key: string;
  type: QuestionType;
  prompt: string;
  imageUrl: string | null;
  durationSeconds: number;
  basePoints: number;
  explanation: string | null;
  options: EditorOption[];
}

export interface QuizDetail {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  coverImageUrl: string | null;
  status: QuizStatus;
  hasDraft: boolean;
  isPublished: boolean;
  editingVersionNumber: number | null;
  publishedVersionNumber: number | null;
  publishedAt: string | null;
  savedAt: string;
  sessionCount: number;
  canEdit: boolean;
  questions: ServerQuestion[];
}

export interface ServerQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  imageUrl: string | null;
  durationSeconds: number;
  basePoints: number;
  explanation: string | null;
  options: { id: string; text: string; imageUrl: string | null; isCorrect: boolean }[];
}

export interface SaveDraftResponse {
  savedAt: string;
  versionNumber: number;
  questions: ServerQuestion[];
}

export interface SessionDetail {
  id: string;
  quizId: string;
  quizTitle: string;
  quizVersionNumber: number;
  hostName: string;
  status: string;
  pin: string | null;
  joinUrl: string | null;
  qrSvgDataUri: string | null;
  settings: SessionSettings;
  questionCount: number;
  participantCount: number;
  stateVersion: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  canViewAllReports: boolean;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}
