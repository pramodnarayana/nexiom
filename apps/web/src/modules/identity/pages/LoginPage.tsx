import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/shared/hooks/useAuth';
import { authClient } from '@/shared/lib/auth-client';
import { hasPermission } from '@/shared/lib/auth/utils';
import { Actions, AppRoutes, Resources } from '@/shared/lib/auth/constants';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { PasswordInput } from '@/shared/components/ui/password-input';
import { Icons } from '@/shared/components/icons';

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

    // If the user visits /login but is already authenticated, send them to their portal.
    useEffect(() => {
        if (user && !isLoading) {
            // Permission-based redirect
            // If user can view the dashboard (admin level), they belong in the admin dashboard.
            const target = hasPermission(user.permissions, Resources.ADMIN_DASHBOARD, Actions.VIEW)
                ? AppRoutes.ADMIN.ROOT
                : AppRoutes.TENANT.ROOT;
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
            const { error } = await authClient.signIn.email({
                email,
                password,
            });

            if (error) {
                throw new Error(error.message || 'Login failed');
            }

            // Standard Better Auth Login succeeded, identifying cookie is set.
            // Now fetch the ENRICHED session (with permissions) from our custom endpoint.
            // The native signIn.email response lacks custom permissions fields.
            const API_URL = import.meta.env.VITE_API_URL;
            if (!API_URL) throw new Error("VITE_API_URL is missing");

            const sessionRes = await fetch(`${API_URL}/auth/refresh-session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include', // Important to send the just-set cookie
            });

            if (!sessionRes.ok) {
                throw new Error('Failed to fetch user profile');
            }

            const enrichedData = await sessionRes.json();

            // Map enriched data to AuthContext state
            const authState = {
                accessToken: enrichedData.session?.token,
                user: enrichedData.user
            };

            setAuthState(authState);

            const rawUser = enrichedData.user;
             
            const userPermissions = (rawUser).permissions || [];
            console.log('[LoginPage] User Permissions:', userPermissions);
            console.log('[LoginPage] Checking for:', Resources.ADMIN_DASHBOARD, Actions.VIEW);

            const isAdmin = hasPermission(userPermissions, Resources.ADMIN_DASHBOARD, Actions.VIEW);

            const fallback = isAdmin ? AppRoutes.ADMIN.ROOT : AppRoutes.TENANT.ROOT;

            const searchParams = new URLSearchParams(globalThis.location.search);
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
                <CardHeader className="text-center pb-2">
                    <CardTitle className="text-2xl">Login</CardTitle>
                    <div className="text-sm text-muted-foreground mt-2">
                        Don't have an account?{' '}
                        <Link to={AppRoutes.AUTH.SIGNUP} className="underline underline-offset-4 hover:text-primary">
                            Sign Up
                        </Link>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Button
                        type="button"
                        variant="outline"
                        className="w-full font-medium gap-2"
                        onClick={async () => {
                            try {
                                await authClient.signIn.social({
                                    provider: "google",
                                    callbackURL: `${globalThis.location.origin}${AppRoutes.AUTH.CALLBACK}`,
                                    // @ts-expect-error - 'prompt' is a valid Google OAuth param but missing in better-auth types
                                    prompt: "select_account"
                                });
                            } catch (error) {
                                console.error('Social login error', error);
                                setError('Failed to initiate Google login');
                            }
                        }}
                    >
                        <Icons.Google className="h-4 w-4" />
                        Sign in with Google
                    </Button>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t border-border" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-background px-2 text-muted-foreground">Or</span>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                        <Input
                            type="email"
                            placeholder="Email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                        />

                        <PasswordInput
                            id="password"
                            placeholder="Password"
                            value={password}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                            required
                        />

                        <Button type="submit" disabled={loading} className="w-full">
                            {loading ? 'Logging in...' : 'Login'}
                        </Button>

                        <div className="text-center">
                            <Link
                                to={AppRoutes.AUTH.FORGOT_PASSWORD}
                                className="text-sm text-muted-foreground hover:text-primary underline underline-offset-4"
                            >
                                Forgot Password?
                            </Link>
                        </div>
                    </form>

                    {error && (
                        <p className="mt-4 text-sm text-center text-destructive font-medium">
                            {error}
                        </p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
