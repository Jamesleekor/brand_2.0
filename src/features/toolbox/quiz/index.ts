// 퀴즈 로얄 — 화면 묶음 (필요할 때만 불러온다)
import { lazy } from 'react';

export const QuizSetupPage = lazy(() => import('./QuizSetupPage').then((m) => ({ default: m.QuizSetupPage })));
export const QuizConsolePage = lazy(() => import('./QuizConsolePage').then((m) => ({ default: m.QuizConsolePage })));
export const QuizScreenPage = lazy(() => import('./QuizScreenPage').then((m) => ({ default: m.QuizScreenPage })));
export const StudentQuizPage = lazy(() => import('./StudentQuizPage').then((m) => ({ default: m.StudentQuizPage })));
