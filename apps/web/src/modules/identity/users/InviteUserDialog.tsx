import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/shared/components/ui/dialog";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/shared/components/ui/form";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/shared/components/ui/select";

import { Input } from "@/shared/components/ui/input";
import { Button } from "@/shared/components/ui/button";
import { Mail, Loader2 } from "lucide-react";
import { useToast } from "@/shared/hooks/use-toast";
import { useCreate, useList } from "@refinedev/core";
import { useResourceName, useAppScope } from "@/shared/contexts/useAppScope";

// Schema matching Backend CreateInvitationSchema
const inviteUserSchema = z.object({
    email: z.string().email("Invalid email address"),
    role: z.string().min(1, "Role is required"),
});

type InviteUserFormValues = z.infer<typeof inviteUserSchema>;

export function InviteUserDialog() {
    const [open, setOpen] = useState(false);
    const { toast } = useToast();
    const { mutate: create, isLoading } = useCreate();
    const invitationResource = useResourceName('INVITATIONS');
    const { scope } = useAppScope();

    // Fetch Roles
    const { data: rolesData, isLoading: isLoadingRoles } = useList({
        resource: "roles",
        filters: [
            {
                field: "scope",
                operator: "eq",
                value: scope,
            },
        ],
        queryOptions: {
            enabled: open,
            staleTime: 5 * 60 * 1000, // Cache for 5 minutes
        }
    });

    const roles = useMemo(() => rolesData?.data || [], [rolesData]);

    const form = useForm<InviteUserFormValues>({
        resolver: zodResolver(inviteUserSchema),
        defaultValues: {
            email: "",
            role: "",
        },
    });

    // Update default role when roles are loaded
    useEffect(() => {
        if (open && roles.length > 0) {
            // Default to 'member' or first available
            const def = (roles.find(r => r.id === 'member')?.id as string) || (roles[0]?.id as string);
            if (def && !form.getValues('role')) {
                form.setValue('role', def);
            }
        }
    }, [open, roles, form]);

    const onSubmit = (data: InviteUserFormValues) => {
        create(
            {
                resource: invitationResource,
                values: {
                    ...data,
                    // The backend handles organizationId injection based on user token.
                },
                successNotification: false,
                errorNotification: false,
            },
            {
                onSuccess: () => {
                    setOpen(false);
                    form.reset();
                    toast({
                        title: "Invitation Sent",
                        description: `Invitation sent to ${data.email}.`,
                    });
                },
                onError: (error: unknown) => {
                    console.error(error);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const responseData = (error as any)?.response?.data;
                    let message = "An unknown error occurred";

                    if (responseData?.message) {
                        if (Array.isArray(responseData.message)) {
                            message = responseData.message.join(", ");
                        } else if (typeof responseData.message === "object") {
                            message = JSON.stringify(responseData.message);
                        } else {
                            message = String(responseData.message);
                        }
                    } else if (error instanceof Error) {
                        message = error.message;
                    }

                    toast({
                        variant: "destructive",
                        title: "Failed to invite user",
                        description: message,
                    });
                },
            }
        );
    };

    // Render role select options based on loading state and available roles
    const renderRoleOptions = () => {
        if (isLoadingRoles) {
            return <SelectItem value="loading" disabled>Loading roles...</SelectItem>;
        }

        if (roles.length === 0) {
            return <SelectItem value="no-roles" disabled>No roles available</SelectItem>;
        }

        return roles.map((role) => (
            <SelectItem key={String(role.id)} value={String(role.id)}>
                {role.name}
            </SelectItem>
        ));
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button>
                    <Mail className="mr-2 h-4 w-4" />
                    Invite User
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Invite User</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Email Address</FormLabel>
                                    <FormControl>
                                        <Input placeholder="colleague@company.com" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="role"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Role</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select a role" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {renderRoleOptions()}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <DialogFooter>
                            <Button
                                type="submit"
                                disabled={isLoading || isLoadingRoles}
                                className="w-full sm:w-auto"
                            >
                                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Send Invitation
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog >
    );
}
