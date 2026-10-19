import type { QuestionType } from './constants';

export interface DashboardStats {
  totals: { quizzes: number; sessions: number; participants: number; answers: number };
  averageAccuracy: number | null;
  recentSessions: SessionListItem[];
  topQuizzes: { quizId: string; title: string; sessions: number }[];
}

export interface SessionListItem {
  id: string;
  quizId: string;
  quizTitle: string;
  hostName: string;
  status: string;
  pin: string | null;
  participantCount: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ReportParticipantRow {
  participantId: string;
  rank: number;
  nickname: string;
  totalScore: number;
  correctCount: number;
  answeredCount: number;
  averageResponseMs: number | null;
  status: string;
}

export interface ReportQuestionRow {
  questionId: string;
  position: number;
  type: QuestionType;
  prompt: string;
  basePoints: number;
  totalAnswers: number;
  correctAnswers: number;
  accuracy: number | null;
  averageResponseMs: number | null;
  options: { optionId: string; text: string; isCorrect: boolean; count: number }[];
}

export interface ReportAnswerCell {
  participantId: string;
  questionId: string;
  selectedOptionIds: string[];
  isCorrect: boolean | null;
  scoreAwarded: number;
  responseTimeMs: number;
}

export interface SessionReport {
  session: SessionListItem & { quizVersionNumber: number };
  summary: {
    participants: number;
    answers: number;
    averageAccuracy: number | null;
    averageResponseMs: number | null;
    hardestQuestionId: string | null;
    easiestQuestionId: string | null;
  };
  participants: ReportParticipantRow[];
  questions: ReportQuestionRow[];
  answers: ReportAnswerCell[];
}
