import { useState, useEffect, type ReactNode } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/shared/hooks/useAuth';
import { authClient } from '@/shared/lib/auth-client';
import { AppRoutes } from '@/shared/lib/auth/constants';
import { getHomePathForUser } from '@/shared/lib/auth/utils';
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
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState<ReactNode>('');
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
            // Use provided names or derive names from email for streamlined signup (only if empty)
            const derivedFirstName = firstName || email.split('@')[0];
            const derivedLastName = lastName || "";
            const domain = email.split('@')[1];
            const derivedCompany = domain
                ? domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1)
                : 'My Organization';

            if (isInviteFlow) {
                // --- INVITE FLOW (User Only + Auto Login + Auto Accept) ---
                // We utilize the dedicated Atomic Endpoint for this.

                // Robust extraction using URL API
                let inviteIdParam: string | null = null;
                try {
                    if (redirectUrl) {
                        const urlObj = new URL(redirectUrl, globalThis.location.origin);
                        inviteIdParam = urlObj.searchParams.get('id');
                    }
                } catch (e) {
                    console.error('[SignupPage] URL Parsing Error:', e);
                }

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

                // Remove logging or redact sensitive fields
                if (import.meta.env.DEV) {
                    console.log('[SignupPage] Sending Payload:', { ...payload, password: '[REDACTED]' });
                }

                const res = await fetch(`${API_URL}/auth/complete-invite`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(payload),
                });

                if (!res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData.message || 'Failed to accept invitation');
                }

                const sessionData = await res.json(); // { session: ..., user: ... }
                // Remove in production or redact sensitive data
                if (import.meta.env.DEV) {
                    console.log('[SignupPage] Response received for user:', sessionData?.user?.email);
                }

                if (sessionData?.session) {
                    // Update Auth Context with new Session
                    setAuthState({
                        user: sessionData.user,
                        accessToken: sessionData.session.token // Using 'token' from session
                    });


                    // --- PERMISSION BASED REDIRECT ---
                    // Redirect user to their home page based on role/permissions
                    const user = sessionData.user as { permissions?: string[] };
                    const homePath = getHomePathForUser(user);
                    navigate(homePath);
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
            let errorMessage = "An unknown error occurred";
            if (err instanceof Error) {
                errorMessage = err.message;
            }

            // SMART ERROR HANDLING: User already exists (e.g. was soft-deleted or re-invited)
            if (errorMessage.toLowerCase().includes("already registered") || errorMessage.toLowerCase().includes("already exists")) {
                setError(
                    <div className="flex flex-col gap-2 items-center">
                        <span>It looks like you already have an account.</span>
                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full mt-1 border-primary text-primary hover:bg-primary/10"
                            onClick={() => {
                                const params = new URLSearchParams();
                                if (redirectUrl) params.set('to', redirectUrl);
                                if (email) params.set('email', email);
                                const search = params.toString();
                                navigate(`/login${search ? `?${search}` : ''}`);
                            }}
                        >
                            Log in to Accept Invite
                        </Button>
                    </div>
                );
            } else {
                setError(errorMessage);
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
                            to={isInviteFlow ? `/login?to=${encodeURIComponent(redirectUrl || '')}` : "/login"}
                            className="underline underline-offset-4 hover:text-primary"
                        >
                            Sign In
                        </Link>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Input
                                    id="firstName"
                                    placeholder="First Name"
                                    type="text"
                                    autoCapitalize="words"
                                    autoCorrect="off"
                                    disabled={loading}
                                    value={firstName}
                                    onChange={(e) => setFirstName(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="grid gap-2">
                                <Input
                                    id="lastName"
                                    placeholder="Last Name"
                                    type="text"
                                    autoCapitalize="words"
                                    autoCorrect="off"
                                    disabled={loading}
                                    value={lastName}
                                    onChange={(e) => setLastName(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

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
                        <div className="mt-4 text-sm text-center text-destructive font-medium">
                            {error}
                        </div>
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
