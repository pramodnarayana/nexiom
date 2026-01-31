import { Routes, Route } from 'react-router-dom';
import { Toaster } from "@/shared/components/ui/toaster";

import { MarketingRoutes } from './MarketingRoutes';
import { AuthRoutes } from './AuthRoutes';
import { TenantRoutes } from './TenantRoutes';
import { AdminRoutes } from './AdminRoutes';

export function AppRouter() {
    return (
        <>
            <Routes>
                {/* note: invoking to return fragments, as <Routes> strictly accepts <Route> or Fragment children */}
                {MarketingRoutes()}
                {AuthRoutes()}

                {/* Tenant Routes */}
                <Route path="/dashboard/*" element={<TenantRoutes />} />

                {/* Admin Routes */}
                <Route path="/admin/*" element={<AdminRoutes />} />
            </Routes>
            <Toaster />
        </>
    );
}
