import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { authClient } from '../../lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export function ResetPasswordPage() {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [isSuccess, setIsSuccess] = useState(false);
    const [loading, setLoading] = useState(false);

    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!token) {
            setError('Invalid or missing reset token.');
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        setLoading(true);

        try {
            const res = await authClient.resetPassword({
                newPassword: password,
                token
            });

            if (res.error) {
                throw new Error(res.error.message);
            }

            // Success - better-auth usually logs the user in or returns success.
            setIsSuccess(true);
            // navigate('/login'); // Removed immediate redirect
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

    if (isSuccess) {
        return (
            <div className="flex justify-center items-center min-h-[80vh] bg-background">
                <Card className="w-[350px]">
                    <CardHeader className="text-center">
                        <CardTitle className="text-green-600">Success</CardTitle>
                        <CardDescription>
                            Your password has been reset successfully.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex justify-center">
                        <Button onClick={() => navigate('/login')} className="w-full">
                            Go to Login
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (!token) {
        return (
            <div className="flex justify-center items-center min-h-[80vh] bg-background">
                <Card className="w-[350px]">
                    <CardHeader className="text-center">
                        <CardTitle className="text-destructive">Invalid Link</CardTitle>
                        <CardDescription>This password reset link is invalid or expired.</CardDescription>
                    </CardHeader>
                </Card>
            </div>
        );
    }

    return (
        <div className="flex justify-center items-center min-h-[80vh] bg-background">
            <Card className="w-[350px]">
                <CardHeader className="text-center">
                    <CardTitle>Reset Password</CardTitle>
                    <CardDescription>Enter your new password</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                        <Input
                            type="password"
                            placeholder="New Password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            minLength={8}
                        />
                        <Input
                            type="password"
                            placeholder="Confirm Password"
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            required
                            minLength={8}
                        />
                        <Button type="submit" disabled={loading} className="w-full">
                            {loading ? 'Resetting...' : 'Reset Password'}
                        </Button>
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
