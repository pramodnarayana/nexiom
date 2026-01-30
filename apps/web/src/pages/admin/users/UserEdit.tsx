import { useEffect } from "react";
import { useOne, useUpdate, useParsed, useCustomMutation } from "@refinedev/core";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Save, Send, Loader2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const UserEditSchema = z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email address"),
});

type UserEditFormValues = z.infer<typeof UserEditSchema>;

export const UserEdit = () => {
    const { id } = useParsed();
    const navigate = useNavigate();
    const { toast } = useToast();
    const { mutate: sendInvite, isLoading: inviteLoading } = useCustomMutation();
    const { mutate: update, isLoading: formLoading } = useUpdate();

    const { data: userResult, isLoading: userLoading } = useOne({
        resource: "admin/users",
        id: id,
    });

    const record = userResult?.data;

    const form = useForm<UserEditFormValues>({
        resolver: zodResolver(UserEditSchema),
        defaultValues: {
            name: "",
            email: "",
        },
    });

    useEffect(() => {
        if (record) {
            form.reset({
                name: record.name || "",
                email: record.email || "",
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [record]);

    const onSubmit = (values: UserEditFormValues) => {
        update(
            {
                resource: "admin/users",
                id: id as string,
                values: values,
            },
            {
                onSuccess: () => {
                    toast({
                        title: "Success",
                        description: "User updated successfully",
                    });
                    navigate("/admin/users");
                },
                onError: (error) => {
                    toast({
                        title: "Error",
                        description: error?.message || "Failed to update user",
                        variant: "destructive",
                    });
                },
            }
        );
    };

    const handleInvite = () => {
        if (!record?.id) return;

        const API_URL = import.meta.env.VITE_API_URL || '/api';
        sendInvite({
            url: `${API_URL}/admin/users/${record.id}/invite`,
            method: "post",
            values: {},
            successNotification: {
                message: `Invitation sent to ${record.email}`,
                type: "success",
            },
            errorNotification: (error) => ({
                message: `Failed to send invite: ${error?.message || "unknown error"}`,
                type: "error",
            }),
        });
    };

    if (userLoading) {
        return <div className="p-8 flex items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</div>;
    }

    return (
        <div className="space-y-6 max-w-2xl">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="outline" size="icon" asChild>
                        <Link to="/admin/users">
                            <ArrowLeft className="h-4 w-4" />
                        </Link>
                    </Button>
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight">Edit User</h2>
                        <div className="flex items-center gap-2">
                            <p className="text-muted-foreground">{record?.email}</p>
                            {/* Status Badge */}
                            {record?.emailVerified === false && (
                                <Badge variant="warning" className="text-[10px] h-5 px-1.5">
                                    Unverified
                                </Badge>
                            )}
                        </div>
                    </div>
                </div>

                {/* Header Actions */}
                <div className="flex items-center gap-2">
                    {record?.emailVerified === false && (
                        <Button
                            variant="success"
                            size="sm"
                            onClick={handleInvite}
                            disabled={inviteLoading}
                        >
                            <Send className={`mr-2 h-4 w-4 ${inviteLoading ? 'animate-spin' : ''}`} />
                            {inviteLoading ? 'Sending...' : 'Send Invite'}
                        </Button>
                    )}
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>User Details</CardTitle>
                    <CardDescription>
                        Manage personal information and system access rights.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Full Name</FormLabel>
                                        <FormControl>
                                            <Input placeholder="John Doe" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Email</FormLabel>
                                        <FormControl>
                                            <Input placeholder="john@example.com" type="email" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />



                            <div className="flex justify-end pt-4">
                                <Button type="submit" disabled={formLoading}>
                                    {formLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    {formLoading ? 'Saving...' : 'Save Changes'}
                                </Button>
                            </div>
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
};
