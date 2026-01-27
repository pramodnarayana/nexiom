import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { authClient } from '../../lib/auth-client';
import { hasAdminAccess } from '../../lib/auth/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

/**
 * Component for the Login Page.
 * Handles user credential input and calls the backend login API.
 * Updates the global AuthContext upon success.
 */
export function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const { setAuthState, user, isLoading } = useAuth(); // Type inference from useAuth
    const navigate = useNavigate();

    // Production Grade: Smart Auto-Redirect
    // If the user visits /login but is already authenticated, send them to their portal.
    useEffect(() => {
        if (user && !isLoading) {
            // Permission-based redirect
            // If user can manage tenants or users (system level), they belong in the admin dashboard.
            const target = hasAdminAccess(user.permissions) ? '/admin' : '/dashboard';
            navigate(target);
        }
    }, [user, navigate, isLoading]);

    /**
     * Submit handler for the login form.
     * Prevents default submission, validates, and triggers the API call.
     */
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const API_URL = import.meta.env.VITE_API_URL;
            if (!API_URL) throw new Error("VITE_API_URL is missing");

            const res = await fetch(`${API_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || 'Login failed');
            }

            const data = await res.json();
            // Call AuthProvider to set state
            setAuthState(data);



            // Redirect logic: Respect ?to param, then Fallback
            const searchParams = new URLSearchParams(window.location.search);

            // Default fallback
            const fallback = '/dashboard';

            // Note: systemRole check removed in favor of strict permissions. 
            // We rely on the useEffect above to redirect if they land on /login while authenticated.
            // Or if we wanted to be fancy, we'd check data.user.permissions here if available.
            // For now, simple fallback is safe.

            const toParam = searchParams.get('to');
            // Only allow relative paths to prevent open redirect attacks
            const isValidRedirect = toParam && toParam.startsWith('/') && !toParam.startsWith('//');
            const redirectUrl = isValidRedirect ? toParam : fallback;
            navigate(redirectUrl);

        } catch (err: unknown) {
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError("An unknown error occurred");
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex justify-center items-center min-h-[80vh] bg-background">
            <Card className="w-[350px]">
                <CardHeader className="text-center">
                    <CardTitle className="text-2xl">Login</CardTitle>
                    <CardDescription>Enter your credentials to access your account</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                        <Input
                            type="email"
                            placeholder="Email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                        />
                        {/* Password is currently ignored by backend logic but good to have in UI */}
                        <Input
                            type="password"
                            placeholder="Password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                        />

                        <Button type="submit" disabled={loading} className="w-full">
                            {loading ? 'Logging in...' : 'Login'}
                        </Button>

                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t border-border" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-background px-2 text-muted-foreground">Or</span>
                            </div>
                        </div>

                        <Button
                            type="button"
                            variant="destructive"
                            className="w-full"
                            onClick={async () => {
                                try {
                                    await authClient.signIn.social({
                                        provider: "google",
                                        callbackURL: `${window.location.origin}/dashboard`,
                                        // @ts-expect-error - 'prompt' is a valid Google OAuth param but missing in better-auth types
                                        prompt: "select_account"
                                    });
                                    // The library handles the redirect automatically
                                } catch (error) {
                                    console.error('Social login error', error);
                                    setError('Failed to initiate Google login');
                                }
                            }}
                        >
                            Sign in with Google
                        </Button>
                    </form>

                    {error && (
                        <p className="mt-4 text-sm text-center text-destructive font-medium">
                            {error}
                        </p>
                    )}

                    <div className="mt-6 text-center text-xs text-muted-foreground p-3 bg-muted/50 rounded-md border border-border">
                        Tip: Use any email you added to the User List. <br />
                        (e.g. <code className="bg-muted px-1 rounded text-foreground">test@nexiom.com</code>)
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
