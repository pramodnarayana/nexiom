import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import './App.css';

import { UsersPage } from './pages/UsersPage';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { AuthProvider } from './lib/auth/AuthProvider';
import { AdminLayout } from './layouts/AdminLayout';
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { UserList } from './pages/admin/users/UserList';
import { UserShow } from './pages/admin/users/UserShow';
import { UserEdit } from './pages/admin/users/UserEdit';

import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/react-router";
import { dataProvider } from "./providers/data-provider";
import { authProvider } from "./providers/auth-provider";

/**
 * Admin section wrapper that provides Refine context to admin routes.
 * This component wraps the admin Routes so Refine can manage resources and navigation.
 */
function AdminSection() {
  return (
    <Refine
      authProvider={authProvider}
      dataProvider={dataProvider}
      routerProvider={routerProvider}
      resources={[
        {
          name: "users",
          list: "/admin/users",
          edit: "/admin/users/edit/:id",
          show: "/admin/users/show/:id",
          meta: {
            canDelete: true,
          }
        }
      ]}
      options={{
        syncWithLocation: true,
        warnWhenUnsavedChanges: true,
      }}
    >
      <AdminLayout />
    </Refine>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

          {/* Protected Routes */}
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/users" element={<UsersPage />} />
          </Route>

          {/* Admin Routes - Powered by Refine */}
          <Route path="/admin" element={<AdminSection />}>
            <Route index element={<AdminDashboardPage />} />
            <Route path="users" element={<UserList />} />
            <Route path="users/show/:id" element={<UserShow />} />
            <Route path="users/edit/:id" element={<UserEdit />} />
            <Route path="settings" element={<div>Settings Placeholder</div>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
