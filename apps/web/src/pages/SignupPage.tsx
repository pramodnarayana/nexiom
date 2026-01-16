import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

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
    if (emailParam && !email) {
        setEmail(emailParam);
    }

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
                console.log("Submitting Payload:", payload); // DEBUGGING

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
                    // BOOM 💥 Dashboard
                    navigate('/dashboard');
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
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '50px' }}>
            <div className="card" style={{ width: '350px', padding: '20px' }}>
                <h2>{isInviteFlow ? 'Join Organization' : 'Sign Up'}</h2>
                {isInviteFlow && (
                    <div style={{ marginBottom: '10px', fontSize: '0.9em', color: '#666' }}>
                        Create an account to accept your invitation.
                    </div>
                )}
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <input
                            type="text"
                            placeholder="First Name"
                            value={firstName}
                            onChange={e => setFirstName(e.target.value)}
                            style={{ padding: '8px', flex: 1 }}
                        />
                        <input
                            type="text"
                            placeholder="Last Name"
                            value={lastName}
                            onChange={e => setLastName(e.target.value)}
                            style={{ padding: '8px', flex: 1 }}
                        />
                    </div>
                    <input
                        type="email"
                        placeholder="Work Email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        disabled={!!emailParam} // Lock email if provided by invite
                        style={{ padding: '8px', backgroundColor: emailParam ? '#f0f0f0' : 'white' }}
                    />

                    {!isInviteFlow && (
                        <input
                            type="text"
                            placeholder="Company Name"
                            value={companyName}
                            onChange={e => setCompanyName(e.target.value)}
                            required
                            minLength={2}
                            style={{ padding: '8px' }}
                        />
                    )}

                    <input
                        type="password"
                        placeholder="Password (min 8 chars)"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                        minLength={8}
                        style={{ padding: '8px' }}
                    />
                    <button type="submit" disabled={loading} style={{ padding: '10px' }}>
                        {loading ? 'Creating Account...' : (isInviteFlow ? 'Join & Accept' : 'Sign Up')}
                    </button>
                </form>
                {error && <p style={{ color: 'red', marginTop: '10px' }}>{error}</p>}

                <p style={{ marginTop: '20px', fontSize: '0.9em' }}>
                    Already have an account? <a href={isInviteFlow ? `/login?to=${encodeURIComponent(redirectUrl!)}` : "/login"}>Log in</a>
                </p>
            </div>
        </div>
    );
}
