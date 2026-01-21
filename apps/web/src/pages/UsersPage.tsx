import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { authorizedFetch } from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';


interface User {
    id: string;
    email: string;
    role: string; // or more specific union type
    roleId?: string; // from member table

}

export function UsersPage() {
    const { token } = useAuth();
    const [email, setEmail] = useState('');
    const [role, setRole] = useState('user');
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
        } catch (err: unknown) {
            if (err instanceof Error) {
                setStatus(`Error: ${err.message} `);
            } else {
                setStatus(`Error: Unknown error`);
            }
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="container mx-auto p-6 space-y-6">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">User Management</h2>

            <Card className="border-border">
                <CardHeader>
                    <CardTitle>Add User</CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleAddUser} className="flex gap-4 items-end">
                        <div className="grid gap-2 flex-1">
                            <Input
                                type="email"
                                placeholder="user@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>
                        <div className="w-[180px]">
                            <select
                                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                value={role}
                                onChange={(e) => setRole(e.target.value)}
                            >
                                <option value="user">User</option>
                                <option value="admin">Admin</option>
                            </select>
                        </div>
                        <Button type="submit" disabled={loading}>
                            {loading ? 'Adding...' : 'Add User'}
                        </Button>
                    </form>
                    {status && (
                        <p className={`mt-2 text-sm font-medium ${status.startsWith('Error') ? 'text-destructive' : 'text-success'}`}>
                            {status}
                        </p>
                    )}
                </CardContent>
            </Card>

            <Card className="border-border">
                <CardHeader>
                    <CardTitle>All Users</CardTitle>
                </CardHeader>
                <CardContent>
                    {users.length === 0 ? (
                        <p className="text-muted-foreground">No users found (or loading...)</p>
                    ) : (
                        <div className="rounded-md border border-border">
                            <div className="p-4 grid gap-4">
                                {users.map((u) => (
                                    <div key={u.id} className="flex items-center justify-between p-2 border-b border-border last:border-0">
                                        <div className="flex flex-col">
                                            <span className="font-medium text-foreground">{u.email}</span>
                                            <span className="text-xs text-muted-foreground">ID: {u.id}</span>
                                        </div>
                                        <Badge variant="outline">{u.role || u.roleId}</Badge>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
