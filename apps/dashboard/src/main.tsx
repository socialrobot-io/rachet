import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ApiKeysPage, AppShell, AuthProvider, ConnectedAppsPage, ConsentPage, LoginPage, RequireAuth } from '@/auth';
import { EnrollmentDetailPage, WorkflowDetailPage, WorkflowsPage } from '@/pages';
import { IntegrationsPage, RequireResendOnboarding, ResendIntegrationPage } from '@/resend-integration';
import { TooltipProvider } from '@/components/ui/tooltip';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/login" element={<LoginPage />} />
            <Route path="/auth/consent" element={<ConsentPage />} />
            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route path="/onboarding/integrations" element={<IntegrationsPage onboarding />} />
                <Route path="/onboarding/integrations/resend" element={<ResendIntegrationPage onboarding />} />
                <Route path="/settings/integrations" element={<IntegrationsPage />} />
                <Route path="/settings/integrations/resend" element={<ResendIntegrationPage />} />
                <Route element={<RequireResendOnboarding />}>
                  <Route index element={<WorkflowsPage />} />
                  <Route path="/workflows/:workflowId" element={<WorkflowDetailPage />} />
                  <Route path="/enrollments/:enrollmentId" element={<EnrollmentDetailPage />} />
                  <Route path="/settings/connected-apps" element={<ConnectedAppsPage />} />
                  <Route path="/settings/api-keys" element={<ApiKeysPage />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </StrictMode>,
);
