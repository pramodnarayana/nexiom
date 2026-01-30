import { useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Loader2, XCircle } from "lucide-react";
import { useAuth } from "@/shared/hooks/useAuth";

export const AcceptInvitePage = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { user, isLoading, token } = useAuth();

    // We support both ?token= (legacy/secure) and ?id= (better-auth standard)
    const urlToken = searchParams.get("token");
    const id = searchParams.get("id");
    const inviteId = id || urlToken;

    // Derived State

    // Auto-validate/redirection logic
    useEffect(() => {
        if (!inviteId) {
            // Error state handled by render
            return;
        }

        if (isLoading) return; // Wait for auth check

        // 1. Logged In -> Silent Accept (Idempotent) then Redirect
        if (user) {
            const silentAccept = async () => {
                try {
                    const API_URL = import.meta.env.VITE_API_URL;
                    // Attempt to accept using the active session.
                    // If already a member, backend will likely throw or return success.
                    // Ideally backend should be idempotent.
                    await fetch(`${API_URL}/invitations/accept`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        },
                        credentials: 'include',
                        body: JSON.stringify({ invitationId: inviteId }),
                    });
                    // We intentionally ignore potential errors (e.g. "Already member")
                    // and proceed to dashboard.
                } catch (e) {
                    // Ignore errors (Idempotency)
                    console.warn("Silent accept failed or already member", e);
                } finally {
                    navigate('/dashboard', { replace: true });
                }
            };

            silentAccept();
            return;
        }

        // 2. Not Logged In -> Direct Redirect to Signup (One-Click Join)
        // We pass the invite context via 'to' param so SignupPage can auto-accept.
        const email = searchParams.get('email') ?? '';
        const target = `/signup?to=${encodeURIComponent(`/invite/accept?id=${inviteId}`)}&email=${encodeURIComponent(email)}`;
        navigate(target, { replace: true });

    }, [inviteId, user, isLoading, navigate, searchParams, token]);

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
                    {!inviteId ? (
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
