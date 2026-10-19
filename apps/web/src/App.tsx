import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Spinner } from '@azhoot/ui';
import { AdminLayout } from './components/layout/AdminLayout';
import { RequireAuth } from './components/layout/RequireAuth';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';

const DashboardPage = lazy(() => import('./pages/admin/DashboardPage'));
const QuizzesPage = lazy(() => import('./pages/admin/QuizzesPage'));
const QuizNewPage = lazy(() => import('./pages/admin/QuizNewPage'));
const QuizEditorPage = lazy(() => import('./pages/admin/QuizEditorPage'));
const LibraryPage = lazy(() => import('./pages/admin/LibraryPage'));
const ReportsPage = lazy(() => import('./pages/admin/ReportsPage'));
const ReportDetailPage = lazy(() => import('./pages/admin/ReportDetailPage'));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage'));
const PlansPage = lazy(() => import('./pages/admin/PlansPage'));
const CreditsPage = lazy(() => import('./pages/admin/CreditsPage'));
const AffiliatePage = lazy(() => import('./pages/admin/AffiliatePage'));
const SignupPage = lazy(() =>
  import('./pages/SignupPage').then((m) => ({ default: m.SignupPage })),
);
const SimulatedInvoicePage = lazy(() => import('./pages/SimulatedInvoicePage'));
const MasterLayout = lazy(() => import('./pages/master/MasterLayout'));
const MasterDashboard = lazy(() => import('./pages/master/MasterDashboard'));
const MasterAccounts = lazy(() => import('./pages/master/MasterAccounts'));
const MasterAccountDetail = lazy(() => import('./pages/master/MasterAccountDetail'));
const MasterRevenue = lazy(() => import('./pages/master/MasterRevenue'));
const MasterExpenses = lazy(() => import('./pages/master/MasterExpenses'));
const MasterAnalytics = lazy(() => import('./pages/master/MasterAnalytics'));
const MasterAffiliates = lazy(() => import('./pages/master/MasterAffiliates'));
const MasterSettings = lazy(() => import('./pages/master/MasterSettings'));
const PresentPage = lazy(() => import('./pages/present/PresentPage'));
const JoinPage = lazy(() => import('./pages/play/JoinPage'));
const PlayPage = lazy(() => import('./pages/play/PlayPage'));

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Spinner className="min-h-dvh" />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/cadastro" element={<SignupPage />} />
          <Route path="/pagamento-simulado/:providerId" element={<SimulatedInvoicePage />} />

          <Route element={<RequireAuth />}>
            <Route path="/trocar-senha" element={<ChangePasswordPage />} />
            <Route element={<AdminLayout />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/quizzes" element={<QuizzesPage />} />
              <Route path="/quizzes/novo" element={<RequireAuth permission="editQuizzes" />}>
                <Route index element={<QuizNewPage />} />
              </Route>
              <Route path="/quizzes/:quizId/editar" element={<QuizEditorPage />} />
              <Route path="/biblioteca" element={<LibraryPage />} />
              <Route path="/relatorios" element={<ReportsPage />} />
              <Route path="/relatorios/:sessionId" element={<ReportDetailPage />} />
              <Route path="/configuracoes" element={<SettingsPage />} />
              <Route path="/planos" element={<PlansPage />} />
              <Route path="/creditos" element={<CreditsPage />} />
              <Route path="/afiliado" element={<AffiliatePage />} />
              <Route path="/master" element={<MasterLayout />}>
                <Route index element={<MasterDashboard />} />
                <Route path="usuarios" element={<MasterAccounts />} />
                <Route path="usuarios/:accountId" element={<MasterAccountDetail />} />
                <Route path="receitas" element={<MasterRevenue />} />
                <Route path="despesas" element={<MasterExpenses />} />
                <Route path="analiticos" element={<MasterAnalytics />} />
                <Route path="afiliados" element={<MasterAffiliates />} />
                <Route path="configuracoes" element={<MasterSettings />} />
              </Route>
            </Route>
            <Route path="/apresentar/:sessionId/:stage" element={<PresentPage />} />
            <Route path="/apresentar/:sessionId" element={<PresentPage />} />
          </Route>

          <Route path="/entrar" element={<JoinPage />} />
          <Route path="/jogar/:sessionId" element={<PlayPage />} />
          <Route path="/jogar/:sessionId/resultado" element={<PlayPage />} />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
