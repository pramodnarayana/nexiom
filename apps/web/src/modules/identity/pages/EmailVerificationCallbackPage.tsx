import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/shared/hooks/useAuth';
import { Icons } from '@/shared/components/icons';

export function EmailVerificationCallbackPage() {
    const navigate = useNavigate();
    const { isAuthenticated, isLoading } = useAuth();

    // We expect the backend to have already verified the user and set the session
    // so we just wait for AuthProvider to confirm authentication.
    useEffect(() => {
        if (!isLoading) {
            if (isAuthenticated) {
                // Verification successful and session active
                navigate('/dashboard', { replace: true });
            } else {
                // If we are not authenticated after loading, verification presumably failed
                // or the session wasn't set correctly. Redirect to login.
                // We add a small delay to ensure it's not a race condition with session setting
                const timer = setTimeout(() => {
                    navigate('/login?error=Verification%20failed%20or%20session%20expired', { replace: true });
                }, 1000);
                return () => clearTimeout(timer);
            }
        }
    }, [isAuthenticated, isLoading, navigate]);

    // Always show loading spinner
    return (
        <div className="flex h-screen w-screen items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-4">
                <Icons.Spinner className="h-12 w-12 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                    Verifying your email...
                </p>
            </div>
        </div>
    );
}
