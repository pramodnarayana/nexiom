import { useForm, useParsed } from "@refinedev/core";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Save } from "lucide-react";
import { Link } from "react-router-dom";

export const UserEdit = () => {
    const { id } = useParsed();
    // Using core useForm since we handle UI manually (headless)
    const form = useForm({
        redirect: 'list',
        resource: 'admin/users',
        action: 'edit',
        id: id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    const { formLoading, onFinish, queryResult } = form;

    const record = queryResult?.data?.data;

    // We can use a simple controlled form approach for now without react-hook-form
    // to avoid extra dependencies, or just plain HTML form submission.
    // Refine's onFinish accepts a values object.

    // We can use a simple controlled form approach for now without react-hook-form
    // to avoid extra dependencies, or just plain HTML form submission.
    // Refine's onFinish accepts a values object.

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const values = {
            name: formData.get("name"),
            systemRole: formData.get("systemRole"),
        };
        await onFinish(values);
    };

    if (formLoading && !record) {
        return <div>Loading...</div>;
    }

    return (
        <div className="space-y-6 max-w-2xl">
            <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" asChild>
                    <Link to="/admin/users">
                        <ArrowLeft className="h-4 w-4" />
                    </Link>
                </Button>
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Edit User</h2>
                    <p className="text-muted-foreground">{record?.email}</p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>User Details</CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <label htmlFor="name" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Full Name</label>
                            <Input
                                id="name"
                                name="name"
                                defaultValue={record?.name}
                                placeholder="John Doe"
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="systemRole" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">System Role</label>
                            <div className="relative">
                                <select
                                    id="systemRole"
                                    name="systemRole"
                                    defaultValue={record?.systemRole || 'user'}
                                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <option value="user">User</option>
                                    <option value="platform_admin">Platform Admin</option>
                                </select>
                            </div>
                            <p className="text-[0.8rem] text-muted-foreground">
                                <strong>Platform Admin:</strong> Full access to Tenant & User Management.
                            </p>
                        </div>

                        <div className="flex justify-end pt-4">
                            <Button type="submit" disabled={formLoading}>
                                <Save className="mr-2 h-4 w-4" />
                                {formLoading ? 'Saving...' : 'Save Changes'}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
};
