import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export function LandingPage() {
    const { login, signup, isAuthenticated } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (isAuthenticated) {
            navigate('/dashboard', { replace: true });
        }
    }, [isAuthenticated, navigate]);

    return (
        <div style={{ textAlign: 'center', marginTop: '50px' }}>
            <h1>Nexiom</h1>
            <div className="card">
                {isAuthenticated ? (
                    <p>Redirecting to Dashboard...</p>
                ) : (
                    <>
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                            <button onClick={() => login()}>
                                Login
                            </button>
                            <button onClick={() => signup()} style={{ backgroundColor: '#2563eb' }}>
                                Sign Up
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
