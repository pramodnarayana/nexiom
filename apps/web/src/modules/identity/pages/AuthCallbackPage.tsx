import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/shared/hooks/useAuth';
import { hasPermission } from '@/shared/lib/auth/utils';
import { Resources, Actions, AppRoutes } from '@/shared/lib/auth/constants';
import { Loader2 } from 'lucide-react';

export function AuthCallbackPage() {
    const { user, isLoading } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (!isLoading) {
            if (user) {
                // Determine redirect based on permissions
                const target = hasPermission(user.permissions, Resources.ADMIN_DASHBOARD, Actions.VIEW)
                    ? AppRoutes.ADMIN.ROOT
                    : AppRoutes.TENANT.ROOT;
                navigate(target, { replace: true });
            } else {
                // Failed to auth, back to login
                navigate(`${AppRoutes.AUTH.LOGIN}?error=auth_failed`, { replace: true });
            }
        }
    }, [user, isLoading, navigate]);

    return (
        <div className="flex h-screen w-screen items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-2 text-muted-foreground">Finalizing authentication...</span>
        </div>
    );
}
