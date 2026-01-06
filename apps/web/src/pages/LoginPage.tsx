import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { authClient } from '../lib/auth-client';

/**
 * Component for the Login Page.
 * Handles user credential input and calls the backend login API.
 * Updates the global AuthContext upon success.
 */
export function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const { setAuthState, user } = useAuth(); // Type inference from useAuth
    const navigate = useNavigate();

    // Redirect if already logged in
    useEffect(() => {
        if (user) {
            navigate('/dashboard');
        }
    }, [user, navigate]);

    /**
     * Submit handler for the login form.
     * Prevents default submission, validates, and triggers the API call.
     */
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const API_URL = import.meta.env.VITE_API_URL;
            if (!API_URL) throw new Error("VITE_API_URL is missing");

            const res = await fetch(`${API_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || 'Login failed');
            }

            const data = await res.json();
            // Call AuthProvider to set state
            setAuthState(data);
            navigate('/dashboard');

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

    return (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '50px' }}>
            <div className="card" style={{ width: '300px', padding: '20px' }}>
                <h2>Login</h2>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <input
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        style={{ padding: '8px' }}
                    />
                    {/* Password is currently ignored by backend logic but good to have in UI */}
                    <input
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        style={{ padding: '8px' }}
                    />
                    <button type="submit" disabled={loading} style={{ padding: '10px' }}>
                        {loading ? 'Logging in...' : 'Login'}
                    </button>

                    <div style={{ textAlign: 'center', margin: '10px 0' }}>OR</div>

                    <button
                        type="button"
                        onClick={async () => {
                            try {
                                await authClient.signIn.social({
                                    provider: "google",
                                    callbackURL: `${window.location.origin}/dashboard`,
                                    // @ts-expect-error - 'prompt' is a valid Google OAuth param but missing in better-auth types
                                    prompt: "select_account"
                                });
                                // The library handles the redirect automatically
                            } catch (error) {
                                console.error('Social login error', error);
                                setError('Failed to initiate Google login');
                            }
                        }}
                        style={{ padding: '10px', backgroundColor: '#db4437', color: 'white', border: 'none', cursor: 'pointer' }}
                    >
                        Sign in with Google
                    </button>
                </form>
                {error && <p style={{ color: 'red', marginTop: '10px' }}>{error}</p>}

                <p style={{ marginTop: '20px', fontSize: '0.9em' }}>
                    Tip: Use any email you added to the User List. <br />
                    (e.g. <code>test@nexiom.com</code>)
                </p>
            </div>
        </div>
    );
}
