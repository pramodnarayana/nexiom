import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export function DashboardPage() {
    const { user, logout } = useAuth();

    return (
        <div style={{ padding: '20px' }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2>Dashboard</h2>
                <nav style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    <Link to="/users">Manage Users</Link>
                    <button onClick={logout}>Logout</button>
                </nav>
            </header>

            <div className="card" style={{ marginTop: '20px' }}>
                <h3>Welcome, {user?.name || user?.email}</h3>
                <p><strong>Role:</strong> {user?.roles.join(', ') || 'Member'}</p>
                <p><strong>Organization:</strong> {user?.organizationName || 'Not Linked'}</p>
                <p><strong>Organization ID:</strong> {user?.organizationId || '-'}</p>
            </div>
        </div>
    );
}
