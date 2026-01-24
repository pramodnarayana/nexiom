import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';
import { AcceptInvitePage } from './pages/public/AcceptInvitePage';
import { AuthProvider } from './lib/auth/AuthProvider';
import './App.css';

import { Toaster } from "@/components/ui/toaster";
import { TenantRoutes } from './routes/TenantRoutes';
import { AdminRoutes } from './routes/AdminRoutes';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/invite/accept" element={<AcceptInvitePage />} />

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
