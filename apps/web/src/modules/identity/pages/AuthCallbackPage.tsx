import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/shared/hooks/useAuth';
import { getHomePathForUser } from '@/shared/lib/auth/utils';
import { AppRoutes } from '@/shared/lib/auth/constants';
import { apiClient } from '@/shared/lib/api-client';
import { Loader2 } from 'lucide-react';

export function AuthCallbackPage() {
    const { user, isLoading, refreshSession } = useAuth();
    const navigate = useNavigate();
    const provisioningRef = useRef(false);

    useEffect(() => {
        if (isLoading) return;

        if (!user) {
            navigate(`${AppRoutes.AUTH.LOGIN}?error=auth_failed`, { replace: true });
            return;
        }

        // First Google sign-in: user has no tenant yet — provision one now.
        // Guard with a ref to prevent double-invocation in StrictMode.
        if (!user.hasTenant && !provisioningRef.current) {
            provisioningRef.current = true;
            apiClient.post('/auth/provision-tenant')
                .then(() => refreshSession())
                .catch((err: unknown) => {
                    console.error('[AuthCallbackPage] Tenant provisioning failed:', err);
                })
                .finally(() => {
                    // New Google users are always regular tenant owners — send to tenant dashboard.
                    navigate(AppRoutes.TENANT.ROOT, { replace: true });
                });
            return;
        }

        // Tenant already exists — use permission-based routing.
        navigate(getHomePathForUser(user), { replace: true });
    }, [user, isLoading, navigate, refreshSession]);

    return (
        <div className="flex h-screen w-screen items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-2 text-muted-foreground">Finalizing authentication...</span>
        </div>
    );
}
