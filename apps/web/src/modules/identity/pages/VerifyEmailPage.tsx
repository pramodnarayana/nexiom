import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { AppRoutes } from '@/shared/lib/auth/constants';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Mail, ArrowLeft } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';

if (!API_URL && import.meta.env.PROD) {
    throw new Error("VITE_API_URL is not defined");
}

/**
 * VerifyEmailPage - Displays after signup to inform user to check their email
 * Includes resend functionality with cooldown timer
 */
export function VerifyEmailPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const email = searchParams.get('email');

    const [resending, setResending] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const [message, setMessage] = useState('');

    // Redirect to signup if no email provided
    useEffect(() => {
        if (!email) {
            navigate(AppRoutes.AUTH.SIGNUP);
        }
    }, [email, navigate]);

    // Cooldown timer
    useEffect(() => {
        if (cooldown > 0) {
            const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [cooldown]);

    const handleResendEmail = async () => {
        if (!email || cooldown > 0 || resending) return;

        setResending(true);
        setMessage('');

        try {
            const response = await fetch(`${API_URL}/auth/resend-verification`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
                credentials: 'include',
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to resend email');
            }

            setMessage('Verification email sent successfully!');
            setCooldown(60); // 60 second cooldown
        } catch (err) {
            setMessage(err instanceof Error ? err.message : 'Failed to resend email');
        } finally {
            setResending(false);
        }
    };

    const handleChangeEmail = () => {
        navigate(AppRoutes.AUTH.SIGNUP);
    };

    if (!email) {
        return null; // Will redirect via useEffect
    }

    return (
        <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-background via-background to-muted/20 p-4">
            <Card className="w-full max-w-md shadow-lg">
                <CardHeader className="text-center space-y-6 pb-8">
                    <div className="flex justify-center">
                        <div className="rounded-full bg-primary/10 p-6 ring-8 ring-primary/5">
                            <Mail className="h-16 w-16 text-primary" />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <CardTitle className="text-3xl font-bold tracking-tight">Check your email</CardTitle>
                        <p className="text-base text-muted-foreground">
                            We've sent a verification link to
                        </p>
                        <p className="text-base font-semibold text-foreground">{email}</p>
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="rounded-lg bg-muted/50 p-4 text-center">
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            Click the link in the email to verify your account and get started.
                            The link will expire in 1 hour.
                        </p>
                    </div>

                    {message && (
                        <div className={`text-sm text-center p-4 rounded-lg font-medium ${message.includes('success')
                            ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 border border-green-200 dark:border-green-800'
                            : 'bg-destructive/10 text-destructive border border-destructive/20'
                            }`}>
                            {message}
                        </div>
                    )}

                    <div className="space-y-4">
                        <Button
                            onClick={handleResendEmail}
                            disabled={resending || cooldown > 0}
                            variant="outline"
                            className="w-full h-11 font-medium"
                        >
                            {resending ? 'Sending...' : (cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Email')}
                        </Button>

                        <div className="flex flex-col gap-3 pt-2">
                            <div className="relative">
                                <div className="absolute inset-0 flex items-center">
                                    <span className="w-full border-t" />
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-background px-2 text-muted-foreground">
                                        Need help?
                                    </span>
                                </div>
                            </div>

                            <div className="flex flex-col gap-2 text-center text-sm">
                                <button
                                    type="button"
                                    onClick={handleChangeEmail}
                                    className="text-muted-foreground hover:text-primary transition-colors underline underline-offset-4 font-medium"
                                >
                                    Change Email Address
                                </button>
                                <Link
                                    to={AppRoutes.AUTH.LOGIN}
                                    className="text-muted-foreground hover:text-primary transition-colors inline-flex items-center justify-center gap-1.5 underline underline-offset-4 font-medium"
                                >
                                    <ArrowLeft className="h-3.5 w-3.5" />
                                    Back to Login
                                </Link>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
