import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/shared/hooks/useAuth';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/shared/components/ui/card';
import { Icons } from '@/shared/components/icons';

export function LandingPage() {
    const { isAuthenticated, isLoading } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (isAuthenticated && !isLoading) {
            navigate('/dashboard', { replace: true });
        }
    }, [isAuthenticated, isLoading, navigate]);

    // Show loading state while checking authentication
    // This prevents the landing page from flashing when verifying email or checking session
    if (isLoading) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-4">
                    <Icons.Spinner className="h-12 w-12 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Loading...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
            <div className="mb-8 text-center">
                <h1 className="text-4xl font-bold tracking-tight text-foreground lg:text-5xl">Soopa</h1>
            </div>

            <Card className="w-[350px]">
                <CardHeader>
                    <CardTitle className="text-center">Welcome</CardTitle>
                    <CardDescription className="text-center">
                        Get started by logging in or creating an account.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col gap-3">
                        <Button onClick={() => navigate('/login')} className="w-full">
                            Login
                        </Button>
                        <Button onClick={() => navigate('/signup')} variant="outline" className="w-full">
                            Sign Up
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
