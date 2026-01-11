import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Edit, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { type UserTableItem } from "./types";

interface UsersProps {
    data: UserTableItem[] | undefined;
    isLoading: boolean;
    basePath: string; // e.g. "/admin/users" or "/dashboard/members"
}

export const Users = ({ data, isLoading, basePath }: UsersProps) => {
    if (isLoading) {
        return <div className="p-4 text-sm text-muted-foreground">Loading users...</div>;
    }

    if (!data || data.length === 0) {
        return (
            <div className="p-8 text-center border rounded-md bg-slate-50">
                <p className="text-muted-foreground">No users found.</p>
            </div>
        );
    }

    return (
        <div className="rounded-md border bg-white shadow-sm">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Verified</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {data.map((user) => (
                        <TableRow key={user.id}>
                            <TableCell className="font-medium">{user.name || "N/A"}</TableCell>
                            <TableCell>{user.email}</TableCell>
                            <TableCell>
                                <Badge variant={user.role === 'admin' || user.role === 'owner' ? 'default' : 'secondary'}>
                                    {user.role}
                                </Badge>
                            </TableCell>
                            <TableCell>
                                {user.emailVerified ? (
                                    <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">Verified</Badge>
                                ) : (
                                    <Badge variant="outline" className="text-yellow-600 border-yellow-200 bg-yellow-50">Pending</Badge>
                                )}
                            </TableCell>
                            <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                    <Button variant="ghost" size="icon" asChild aria-label={`View ${user.name || 'user'}`}>
                                        <Link to={`${basePath}/show/${user.id}`}>
                                            <Eye className="h-4 w-4" />
                                        </Link>
                                    </Button>
                                    <Button variant="ghost" size="icon" asChild aria-label={`Edit ${user.name || 'user'}`}>
                                        <Link to={`${basePath}/edit/${user.id}`}>
                                            <Edit className="h-4 w-4" />
                                        </Link>
                                    </Button>
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
};
