import { useShow } from "@refinedev/core";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Edit } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";

export const UserShow = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const start = useShow<any>({
        resource: "users",
    });

    // Explicitly casting to avoid 'any' lint if possible, or using BaseRecord
    const { queryResult } = start;

    const { data, isLoading } = queryResult;
    const record = data?.data;

    if (isLoading) {
        return <div className="p-4">Loading User Details...</div>;
    }

    return (
        <div className="space-y-6 max-w-3xl">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="outline" size="icon" asChild>
                        <Link to="/admin/users">
                            <ArrowLeft className="h-4 w-4" />
                        </Link>
                    </Button>
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight">User Details</h2>
                        <p className="text-muted-foreground">View user information and metadata.</p>
                    </div>
                </div>
                <Button asChild>
                    <Link to={`/admin/users/edit/${record?.id}`}>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit User
                    </Link>
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Profile Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-muted-foreground">User ID</p>
                            <p className="font-mono text-sm">{record?.id}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-muted-foreground">Email</p>
                            <div className="flex items-center gap-2">
                                <p>{record?.email}</p>
                                {record?.emailVerified ? (
                                    <Badge variant="outline" className="text-green-600 bg-green-50">Verified</Badge>
                                ) : (
                                    <Badge variant="outline" className="text-yellow-600 bg-yellow-50">Unverified</Badge>
                                )}
                            </div>
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-muted-foreground">Full Name</p>
                            <p>{record?.name || "N/A"}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-muted-foreground">Role</p>
                            <Badge variant="secondary">{record?.role || "user"}</Badge>
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-muted-foreground">Organization ID</p>
                            <p className="font-mono text-sm text-slate-500">{record?.organizationId || "None"}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-muted-foreground">Created At</p>
                            <p className="text-sm text-slate-500">{record?.createdAt ? new Date(record.createdAt).toLocaleString() : "N/A"}</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};
