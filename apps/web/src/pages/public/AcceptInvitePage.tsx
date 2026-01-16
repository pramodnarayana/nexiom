import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, XCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export const AcceptInvitePage = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { user, isLoading, token } = useAuth();
    const [status, setStatus] = useState<"validating" | "valid" | "error">("validating");

    // We support both ?token= (legacy/secure) and ?id= (better-auth standard)
    const urlToken = searchParams.get("token");
    const id = searchParams.get("id");
    const inviteId = id || urlToken;

    // Derived State

    // Auto-validate/redirection logic
    useEffect(() => {
        if (!inviteId) {
            setStatus("error");
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

    // We no longer need handleAccept since we redirect immediately.

    if (!inviteId || status === "error") {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50">
                <Card className="w-[400px]">
                    <CardHeader>
                        <CardTitle className="text-red-600 flex items-center">
                            <XCircle className="mr-2" /> Invalid Link
                        </CardTitle>
                        <CardDescription>
                            This invitation link is missing required parameters or is invalid.
                        </CardDescription>
                    </CardHeader>
                </Card>
            </div>
        );
    }

    // Loader while redirecting
    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
    );
};
