import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/shared/hooks/useAuth';
import { authClient } from '@/shared/lib/auth-client';
import { hasPermission } from '@/shared/lib/auth/utils';
import { AppRoutes } from '@/shared/lib/auth/constants';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Loader2 } from 'lucide-react';
import { PasswordInput } from '@/shared/components/ui/password-input';
import { Icons } from '@/shared/components/icons';

const API_URL = import.meta.env.VITE_API_URL;
if (!API_URL) throw new Error("VITE_API_URL is missing");

/**
 * Component for the Signup Page.
 * Handles user registration and auto-login logic.
 */
export function SignupPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // Parse Query Params (for Invitation Flow)
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    // Invitation Context
    const redirectUrl = searchParams.get('to');
    const emailParam = searchParams.get('email');
    const isInviteFlow = !!redirectUrl; // If we have a redirect, we assume it's an invite (User Only)

    // Pre-fill email if provided
    useEffect(() => {
        if (emailParam && !email) {
            setEmail(emailParam);
        }
    }, [emailParam, email]);

    // We need useAuth to update global state if we auto-login
    const { setAuthState } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password !== confirmPassword) {
            setError("Passwords do not match");
            return;
        }

        setLoading(true);

        try {
            // Derive names from email for streamlined signup
            const derivedName = email.split('@')[0];
            const derivedFirstName = derivedName; // Valid default
            const derivedLastName = "";
            const domain = email.split('@')[1];
            const derivedCompany = domain
                ? domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1)
                : 'My Organization';

            if (isInviteFlow) {
                // --- INVITE FLOW (User Only + Auto Login + Auto Accept) ---
                // We utilize the dedicated Atomic Endpoint for this.

                const inviteIdParam = redirectUrl?.includes('id=')
                    ? new URLSearchParams(redirectUrl.split('?')[1]).get('id')
                    : null;

                if (!inviteIdParam) {
                    throw new Error("Invalid Invitation Link");
                }

                const payload = {
                    firstName: derivedFirstName,
                    lastName: derivedLastName,
                    email,
                    password,
                    invitationId: inviteIdParam
                };

                const res = await fetch(`${API_URL}/auth/complete-invite`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });

                if (!res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData.message || 'Failed to accept invitation');
                }

                const sessionData = await res.json(); // { session: ..., user: ... }

                if (sessionData?.session) {
                    // Update Auth Context with new Session
                    setAuthState({
                        user: sessionData.user,
                        accessToken: sessionData.session.token // Using 'token' from session
                    });

                    // --- PERMISSION BASED REDIRECT ---
                    // We check if the user has admin capabilities
                    // Note: ensure your sessions endpoint returns permissions
                    const user = sessionData.user as { permissions?: string[] };

                    if (hasPermission(user.permissions, 'dashboard', 'view')) {
                        navigate('/admin');
                    } else {
                        navigate('/dashboard');
                    }
                } else {
                    // Fallback (Should not happen with new endpoint)
                    alert("Account created, but auto-login failed. Please log in.");
                    navigate('/login');
                }

            } else {
                // --- STANDARD FLOW (Create Tenant via Custom API) ---
                // We persist with the Custom Endpoint because it handles Tenant Creation transactionally.

                const res = await fetch(`${API_URL}/auth/signup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        firstName: derivedFirstName,
                        lastName: derivedLastName,
                        companyName: derivedCompany,
                        email,
                        password,
                        role: 'admin'
                    }),
                });

                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.message || 'Signup failed');
                }

                // Redirect to verification page with email parameter
                navigate(`${AppRoutes.AUTH.VERIFY_EMAIL}?email=${encodeURIComponent(email)}`);
            }

        } catch (err: unknown) {
            console.error(err);
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
            <Card className="w-[400px]">
                <CardHeader className="text-center pb-2">
                    <CardTitle className="text-2xl">
                        {isInviteFlow ? 'Join Organization' : 'Create Account'}
                    </CardTitle>
                    <div className="text-sm text-muted-foreground mt-2">
                        Already have an account?{' '}
                        <Link
                            to={isInviteFlow ? `/login?to=${encodeURIComponent(redirectUrl)}` : "/login"}
                            className="underline underline-offset-4 hover:text-primary"
                        >
                            Sign In
                        </Link>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                        <div className="grid gap-2">
                            <Input
                                type="email"
                                placeholder="Email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                required
                                disabled={!!emailParam}
                                className={emailParam ? "bg-muted text-muted-foreground" : ""}
                            />
                        </div>

                        <div className="grid gap-2">
                            <PasswordInput
                                type="password"
                                placeholder="Password (min 8 chars)"
                                value={password}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                                required
                                minLength={8}
                            />
                        </div>

                        <div className="grid gap-2">
                            <PasswordInput
                                type="password"
                                placeholder="Confirm Password"
                                value={confirmPassword}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)}
                                required
                            />
                        </div>

                        <Button type="submit" disabled={loading} className="w-full mt-2">
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {loading ? 'Creating Account...' : (isInviteFlow ? 'Join & Accept' : 'Sign Up')}
                        </Button>
                    </form>

                    {error && (
                        <p className="mt-4 text-sm text-center text-destructive font-medium">
                            {error}
                        </p>
                    )}

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
                        variant="outline"
                        className="w-full font-medium gap-2"
                        onClick={async () => {
                            try {
                                await authClient.signIn.social({
                                    provider: "google",
                                    // [REPLACEMENT_1 - Callback URL]
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
                        Sign up with Google
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
