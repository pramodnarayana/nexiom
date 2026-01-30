import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';
import { AcceptInvitePage } from './pages/public/AcceptInvitePage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { AuthProvider } from './lib/auth/AuthProvider';
import './App.css';

import { Toaster } from "@/components/ui/toaster";
import { TenantRoutes } from './routes/TenantRoutes';
import { AdminRoutes } from './routes/AdminRoutes';
import { AppRoutes } from './lib/auth/constants';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>


          {/* Public Routes */}
          <Route path={AppRoutes.ROOT} element={<LandingPage />} />
          <Route path={AppRoutes.AUTH.LOGIN} element={<LoginPage />} />
          <Route path={AppRoutes.AUTH.SIGNUP} element={<SignupPage />} />
          <Route path={AppRoutes.AUTH.INVITE_ACCEPT} element={<AcceptInvitePage />} />
          <Route path={AppRoutes.AUTH.FORGOT_PASSWORD} element={<ForgotPasswordPage />} />
          <Route path={AppRoutes.AUTH.RESET_PASSWORD} element={<ResetPasswordPage />} />

          {/* Tenant Routes */}
          <Route path="/dashboard/*" element={<TenantRoutes />} />

          {/* Admin Routes */}
          <Route path="/admin/*" element={<AdminRoutes />} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
