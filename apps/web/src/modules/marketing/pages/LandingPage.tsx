import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/shared/hooks/useAuth';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/shared/components/ui/card';

export function LandingPage() {
    const { login, signup, isAuthenticated } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (isAuthenticated) {
            navigate('/dashboard', { replace: true });
        }
    }, [isAuthenticated, navigate]);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
            <div className="mb-8 text-center">
                <h1 className="text-4xl font-bold tracking-tight text-foreground lg:text-5xl">Nexiom</h1>
                <p className="mt-2 text-muted-foreground">Modern Multi-Tenant Platform</p>
            </div>

            <Card className="w-[350px]">
                <CardHeader>
                    <CardTitle className="text-center">Welcome</CardTitle>
                    <CardDescription className="text-center">
                        {isAuthenticated ? 'Redirecting to your dashboard...' : 'Get started by logging in or creating an account.'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {isAuthenticated ? (
                        <div className="flex justify-center p-4">
                            <span className="loading loading-spinner text-primary"></span>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            <Button onClick={() => login()} className="w-full">
                                Login
                            </Button>
                            <Button onClick={() => signup()} variant="outline" className="w-full">
                                Sign Up
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
