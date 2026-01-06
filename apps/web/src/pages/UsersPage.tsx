import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { authorizedFetch } from '../lib/api';

interface User {
    id: string;
    email: string;
    role: string; // or more specific union type
    roleId?: string; // from member table
    [key: string]: any;
}

export function UsersPage() {
    const { token } = useAuth();
    const [email, setEmail] = useState('');
    const [role, setRole] = useState('viewer');
    const [status, setStatus] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [users, setUsers] = useState<User[]>([]);

    useEffect(() => {
        // Fetch users on mount
        let mounted = true;
        authorizedFetch(token, '/users').then((data) => {
            if (mounted && Array.isArray(data)) setUsers(data);
        }).catch(err => console.error("Failed to fetch users", err));

        return () => { mounted = false; };
    }, [token]);

    async function handleAddUser(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setStatus(null);

        try {
            await authorizedFetch(token, '/users', {
                method: 'POST',
                body: JSON.stringify({ email, role, firstName: 'New', lastName: 'Member' }),
            });
            setStatus('User added successfully!');
            setEmail('');
        } catch (err: any) {
            setStatus(`Error: ${err.message} `);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={{ padding: '20px' }}>
            <h2>User Management</h2>

            <div className="card" style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ccc' }}>
                <h3>Add User</h3>
                <form onSubmit={handleAddUser} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <input
                        type="email"
                        placeholder="user@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        style={{ padding: '8px' }}
                    />
                    <select
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        style={{ padding: '8px' }}
                    >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                        <option value="admin">Admin</option>
                    </select>
                    <button type="submit" disabled={loading} style={{ padding: '8px 16px' }}>
                        {loading ? 'Adding...' : 'Add User'}
                    </button>
                </form>
                {status && <p style={{ marginTop: '10px', color: status.startsWith('Error') ? 'red' : 'green' }}>{status}</p>}
            </div>

            <div className="card">
                <h3>All Users</h3>
                {users.length === 0 ? (
                    <p>No users found (or loading...)</p>
                ) : (
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                        {users.map((u) => (
                            <li key={u.id} style={{ padding: '10px', borderBottom: '1px solid #eee' }}>
                                <strong>{u.email}</strong> - {u.role || u.roleId} (ID: {u.id})
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
