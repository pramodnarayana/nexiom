import { useState } from 'react';
import { authClient } from '../../lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Link } from 'react-router-dom';

export function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const res = await authClient.requestPasswordReset({
                email,
                redirectTo: '/reset-password',
            });

            if (res.error) {
                // Determine user-friendly error message
                // Note: better-auth might return generic error for security, 
                // but if it returns "User not found", we map it.
                if (res.error.message?.toLowerCase().includes('not found')) {
                    throw new Error("Email Not Found");
                }
                throw new Error(res.error.message);
            }
            setIsSubmitted(true);
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

    if (isSubmitted) {
        return (
            <div className="flex justify-center items-center min-h-[80vh] bg-background">
                <Card>
                    <CardHeader className="text-center">
                        <CardTitle>Check your email</CardTitle>
                        <CardDescription>
                            Password Reset Request Sent
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="text-center text-sm text-muted-foreground">
                        We have sent a password reset link to <strong>{email}</strong>.
                    </CardContent>
                    <CardFooter className="flex justify-center">
                        <Link to="/login">
                            <Button variant="ghost">Back to Login</Button>
                        </Link>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    return (
        <div className="flex justify-center items-center min-h-[80vh] bg-background">
            <Card className="w-[350px]">
                <CardHeader className="text-center">
                    <CardTitle>Forgot Password</CardTitle>
                    <CardDescription>Enter your email to receive a reset link</CardDescription>
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
                        <Button type="submit" disabled={loading} className="w-full">
                            {loading ? 'Sending...' : 'Send Reset Link'}
                        </Button>
                    </form>
                    {error && (
                        <p className="mt-4 text-sm text-center text-destructive font-medium">
                            {error}
                        </p>
                    )}
                </CardContent>
                <CardFooter className="flex justify-center">
                    <Link to="/login" className="text-sm text-muted-foreground hover:underline">
                        Back to Login
                    </Link>
                </CardFooter>
            </Card>
        </div>
    );
}
