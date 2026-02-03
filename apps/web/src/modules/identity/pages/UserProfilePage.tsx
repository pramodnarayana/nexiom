
import { useAuth } from '@/shared/lib/auth/context';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Avatar, AvatarFallback } from '@/shared/components/ui/avatar';

export function UserProfilePage() {
    const { user } = useAuth();

    if (!user) return null;

    return (
        <div className="container mx-auto py-8">
            <h1 className="text-3xl font-bold mb-8">My Profile</h1>

            <Card className="max-w-2xl">
                <CardHeader>
                    <CardTitle>Personal Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center space-x-4">
                        <Avatar className="h-20 w-20">
                            <AvatarFallback className="text-xl">
                                {user.name?.charAt(0) || user.email.charAt(0).toUpperCase()}
                            </AvatarFallback>
                        </Avatar>
                        <div>
                            <h2 className="text-xl font-semibold">{user.name || 'No Name Set'}</h2>
                            <p className="text-muted-foreground">{user.email}</p>
                        </div>
                    </div>

                    <div className="grid gap-4">
                        <div className="grid gap-2">
                            <div className="text-sm font-medium">User ID</div>
                            <code className="bg-muted p-2 rounded text-sm">{user.id}</code>
                        </div>
                        <div className="grid gap-2">
                            <div className="text-sm font-medium">Roles</div>
                            <div className="text-sm capitalize">
                                {user.roles && user.roles.length > 0 ? user.roles.join(', ') : 'Member'}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
