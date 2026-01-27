import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { hasPermission } from '../../lib/auth/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;
if (!API_URL) throw new Error("VITE_API_URL is missing");

/**
 * Component for the Signup Page.
 * Handles user registration and auto-login logic.
 */
export function SignupPage() {
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [companyName, setCompanyName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
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
        setLoading(true);

        try {
            if (isInviteFlow) {
                // --- INVITE FLOW (User Only + Auto Login + Auto Accept) ---
                // We utilize the dedicated Atomic Endpoint for this.

                const inviteIdParam = redirectUrl && redirectUrl.includes('id=')
                    ? new URLSearchParams(redirectUrl.split('?')[1]).get('id')
                    : null;

                if (!inviteIdParam) {
                    throw new Error("Invalid Invitation Link");
                }

                const payload = {
                    firstName,
                    lastName,
                    email,
                    password,
                    invitationId: inviteIdParam
                };
                // console.log("Submitting Payload:", payload); // DEBUGGING

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

                if (sessionData && sessionData.session) {
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
                        firstName,
                        lastName,
                        companyName,
                        email,
                        password,
                        role: 'admin'
                    }),
                });

                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.message || 'Signup failed');
                }

                alert('Account created! Please log in.');
                navigate('/login');
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
                <CardHeader className="text-center">
                    <CardTitle className="text-2xl">
                        {isInviteFlow ? 'Join Organization' : 'Create Account'}
                    </CardTitle>
                    <CardDescription>
                        {isInviteFlow
                            ? 'Create your account to accept the invitation.'
                            : 'Get started with your new organization.'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                        <div className="flex gap-4">
                            <div className="grid gap-2 flex-1">
                                <Input
                                    id="firstName"
                                    type="text"
                                    placeholder="First Name"
                                    value={firstName}
                                    onChange={e => setFirstName(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="grid gap-2 flex-1">
                                <Input
                                    id="lastName"
                                    type="text"
                                    placeholder="Last Name"
                                    value={lastName}
                                    onChange={e => setLastName(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        {!isInviteFlow && (
                            <div className="grid gap-2">
                                <Input
                                    type="text"
                                    placeholder="Company Name"
                                    value={companyName}
                                    onChange={e => setCompanyName(e.target.value)}
                                    required
                                    minLength={2}
                                />
                            </div>
                        )}

                        <div className="grid gap-2">
                            <Input
                                type="email"
                                placeholder="Work Email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                required
                                disabled={!!emailParam}
                                className={emailParam ? "bg-muted text-muted-foreground" : ""}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Input
                                type="password"
                                placeholder="Password (min 8 chars)"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                                minLength={8}
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

                    <div className="mt-6 text-center text-sm text-muted-foreground">
                        Already have an account?{' '}
                        <Link
                            to={isInviteFlow ? `/login?to=${encodeURIComponent(redirectUrl!)}` : "/login"}
                            className="underline underline-offset-4 hover:text-primary"
                        >
                            Log in
                        </Link>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
