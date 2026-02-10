import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Loader2, XCircle } from "lucide-react";
import { useAuth } from "@/shared/hooks/useAuth";
import { Button } from "@/shared/components/ui/button";

export const AcceptInvitePage = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { user, isLoading, token } = useAuth();

    // We support both ?token= (legacy/secure) and ?id= (better-auth standard)
    const urlToken = searchParams.get("token");
    const id = searchParams.get("id");
    const inviteId = id || urlToken;

    // Derived State
    const [error, setError] = useState<string | null>(null);
    const [retryCount, setRetryCount] = useState(0);

    // Auto-validate/redirection logic
    useEffect(() => {
        if (!inviteId) return;
        if (isLoading) return; // Wait for auth check

        // 1. Logged In -> Silent Accept (Idempotent) then Redirect
        if (user) {
            const silentAccept = async () => {
                try {
                    const API_URL = import.meta.env.VITE_API_URL;
                    const res = await fetch(`${API_URL}/invitations/accept`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        },
                        credentials: 'include',
                        body: JSON.stringify({ invitationId: inviteId }),
                    });

                    if (!res.ok) {
                        let message = "Failed to accept invitation";
                        try {
                            const data = await res.json();
                            message = data.message || message;
                        } catch {
                            // Response wasn't JSON, use default message
                        }
                        throw new Error(message);
                    }

                    // Success -> Dashboard
                    navigate('/dashboard', { replace: true });

                } catch (e: unknown) {
                    console.error("Silent accept failed:", e);
                    // CRITICAL FIX: Do NOT auto-redirect on failure. Show error.
                    const message = e instanceof Error ? e.message : "Failed to accept invitation";
                    setError(message);
                }
            };

            silentAccept();
            return;
        }

        // 2. Not Logged In -> Direct Redirect to Signup (One-Click Join)
        const email = searchParams.get('email') ?? '';
        const target = `/signup?to=${encodeURIComponent(`/invite/accept?id=${inviteId}`)}&email=${encodeURIComponent(email)}`;
        navigate(target, { replace: true });

    }, [inviteId, user, isLoading, navigate, searchParams, token, retryCount]);

    // Polished UI matching LoginPage
    return (
        <div className="flex justify-center items-center min-h-[80vh] bg-background">
            <Card className="w-[350px]">
                <CardHeader className="text-center">
                    <CardTitle className="text-2xl">Join Organization</CardTitle>
                    <CardDescription>
                        {!inviteId
                            ? "Action Required"
                            : "Validating your invitation..."}
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-center justify-center py-6 gap-4">
                    {error ? (
                        <div className="text-center space-y-4">
                            <div className="flex justify-center text-destructive mb-2">
                                <XCircle className="h-10 w-10" />
                            </div>
                            <p className="text-sm font-medium text-destructive">
                                {error}
                            </p>
                            <div className="flex gap-2 justify-center">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        setError(null);
                                        setRetryCount(prev => prev + 1);
                                    }}
                                >
                                    Retry
                                </Button>
                                <Button variant="default" size="sm" onClick={() => navigate('/dashboard')}>Go to Dashboard</Button>
                            </div>
                        </div>
                    ) : !inviteId ? (
                        <div className="text-center space-y-2">
                            <div className="flex justify-center text-destructive mb-2">
                                <XCircle className="h-10 w-10" />
                            </div>
                            <p className="text-sm font-medium text-destructive">
                                Invitation Missing
                            </p>
                            <p className="text-xs text-muted-foreground">
                                No invitation ID found. Please check your link.
                            </p>
                        </div>
                    ) : (
                        <>
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Please wait while we set up your access.</p>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};
