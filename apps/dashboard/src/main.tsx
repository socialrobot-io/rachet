import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell, AuthProvider, ConnectedAppsPage, ConsentPage, LoginPage, RequireAuth } from '@/auth';
import { EnrollmentDetailPage, WorkflowDetailPage, WorkflowsPage } from '@/pages';
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
                <Route index element={<WorkflowsPage />} />
                <Route path="/workflows/:workflowId" element={<WorkflowDetailPage />} />
                <Route path="/enrollments/:enrollmentId" element={<EnrollmentDetailPage />} />
                <Route path="/settings/connected-apps" element={<ConnectedAppsPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </StrictMode>,
);
