// 모험가 도구함 — 화면 묶음 (필요할 때만 불러온다)
import { lazy } from 'react';

export const StudentToolboxHome = lazy(() => import('./student/StudentToolbox').then((m) => ({ default: m.StudentToolboxHome })));
export const StudentPersonalToolPage = lazy(() => import('./student/StudentToolbox').then((m) => ({ default: m.StudentPersonalToolPage })));
export const StudentActivityPage = lazy(() => import('./student/StudentActivityPage').then((m) => ({ default: m.StudentActivityPage })));
export const TeacherToolboxHub = lazy(() => import('./teacher/TeacherToolbox').then((m) => ({ default: m.TeacherToolboxHub })));
export const TeacherPersonalToolPage = lazy(() => import('./teacher/TeacherToolbox').then((m) => ({ default: m.TeacherPersonalToolPage })));
export const CreateActivityPage = lazy(() => import('./teacher/CreateActivity').then((m) => ({ default: m.CreateActivityPage })));
export const ActivityConsolePage = lazy(() => import('./teacher/ActivityConsole').then((m) => ({ default: m.ActivityConsolePage })));
export const ToolboxBroadcastPage = lazy(() => import('./teacher/BroadcastPage').then((m) => ({ default: m.ToolboxBroadcastPage })));
