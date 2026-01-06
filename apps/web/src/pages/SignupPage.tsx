import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

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

    // We can auto-login or redirect to login.
    // For now, let's redirect to login after signup to keep flows clear.
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
            const res = await fetch(`${API_URL}/auth/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    firstName,
                    lastName,
                    companyName,
                    email,
                    password,
                    role: 'admin' // Signup creates a new tenant, so they are always Admin
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || 'Signup failed');
            }

            // Success
            alert('Account created! Please log in.');
            navigate('/login');

        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '50px' }}>
            <div className="card" style={{ width: '350px', padding: '20px' }}>
                <h2>Sign Up</h2>
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
                        style={{ padding: '8px' }}
                    />
                    <input
                        type="text"
                        placeholder="Company Name"
                        value={companyName}
                        onChange={e => setCompanyName(e.target.value)}
                        required
                        minLength={2}
                        style={{ padding: '8px' }}
                    />
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
                        {loading ? 'Creating Account...' : 'Sign Up'}
                    </button>
                </form>
                {error && <p style={{ color: 'red', marginTop: '10px' }}>{error}</p>}

                <p style={{ marginTop: '20px', fontSize: '0.9em' }}>
                    Already have an account? <a href="/login">Log in</a>
                </p>
            </div>
        </div>
    );
}
