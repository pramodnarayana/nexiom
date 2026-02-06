import { Button } from "@/shared/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/shared/components/ui/select";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useUpdate, useOne } from "@refinedev/core";
import { useEffect } from "react";
import { useToast } from "@/shared/hooks/use-toast";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@/shared/components/ui/skeleton";

const UpdateTenantSchema = z.object({
    name: z.string().min(1, "Name is required").optional(),
    slug: z.string().min(3, "Slug must be at least 3 chars").regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, and hyphens only").optional(),
    logo: z.string().url("Must be a valid URL").optional().or(z.literal("")),
    status: z.enum(["active", "disabled", "suspended"]).optional(),
}).refine((data) => {
    return (
        data.name !== undefined ||
        data.slug !== undefined ||
        data.status !== undefined ||
        (data.logo !== undefined)
    );
}, {
    message: "At least one field must be provided",
    path: ["root"],
});

type UpdateTenantFormValues = z.infer<typeof UpdateTenantSchema>;

interface TenantEditProps {
    tenantId?: string;
    onCancel?: () => void;
}

export const TenantEdit = ({ tenantId, onCancel }: TenantEditProps) => {
    const params = useParams();
    const id = tenantId || params.id;
    const navigate = useNavigate();
    const { mutate, isLoading: isUpdating } = useUpdate();
    const { toast } = useToast();

    const { data: tenantData, isLoading: isLoadingTenant } = useOne({
        resource: "admin/tenants",
        id: id as string,
        queryOptions: {
            enabled: !!id,
        },
    });

    const tenant = tenantData?.data;

    const form = useForm<UpdateTenantFormValues>({
        resolver: zodResolver(UpdateTenantSchema),
        defaultValues: {
            name: "",
            slug: "",
            logo: "",
            status: "active",
        },
    });

    const { reset } = form;

    // Reset form when tenant loads
    useEffect(() => {
        if (tenant) {
            reset({
                name: tenant.name,
                slug: tenant.slug || "",
                logo: tenant.logo || "",
                status: tenant.status as "active" | "disabled" | "suspended",
            });
        }
    }, [tenant, reset]);

    const onSubmit = (values: UpdateTenantFormValues) => {
        if (!id) return;

        mutate(
            {
                resource: "admin/tenants",
                id,
                values,
            },
            {
                onSuccess: () => {
                    toast({
                        title: "Success",
                        description: "Tenant updated successfully.",
                        variant: "default",
                    });
                    if (onCancel) {
                        onCancel();
                    } else {
                        navigate("/admin/tenants");
                    }
                },
                onError: (error) => {
                    toast({
                        title: "Error",
                        description: error?.message || "Failed to update tenant.",
                        variant: "destructive",
                    });
                },
            }
        );
    };

    // ... existing code

    if (isLoadingTenant) {
        return (
            <div className="space-y-6 animate-pulse">
                {!tenantId && (
                    <div className="flex items-center space-x-4">
                        <Skeleton className="h-10 w-10" />
                        <Skeleton className="h-8 w-48" />
                    </div>
                )}
                <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
                    <div className="flex flex-col space-y-1.5 p-6">
                        <Skeleton className="h-6 w-32" />
                    </div>
                    <div className="p-6 pt-0 space-y-4 max-w-2xl">
                        <div className="space-y-2">
                            <Skeleton className="h-4 w-16" />
                            <Skeleton className="h-10 w-full" />
                        </div>
                        <div className="space-y-2">
                            <Skeleton className="h-4 w-16" />
                            <Skeleton className="h-10 w-full" />
                        </div>
                        <div className="space-y-2">
                            <Skeleton className="h-4 w-16" />
                            <Skeleton className="h-10 w-full" />
                        </div>
                        <div className="space-y-2">
                            <Skeleton className="h-4 w-16" />
                            <Skeleton className="h-10 w-full" />
                        </div>
                        <div className="flex justify-end pt-4">
                            <Skeleton className="h-10 w-32" />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (!tenant) {
        return <div className="p-8">Tenant not found</div>;
    }

    return (
        <div className="space-y-6">
            {!tenantId && (
                <div className="flex items-center space-x-4">
                    <Button variant="outline" size="icon" onClick={() => navigate("/admin/tenants")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight">Edit Tenant</h2>
                    </div>
                </div>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Tenant Details</CardTitle>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 max-w-2xl">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Company Name</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="Acme Corp"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="slug"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Slug</FormLabel>
                                        <FormControl>
                                            <Input placeholder="acme-corp" {...field} />
                                        </FormControl>
                                        <p className="text-xs text-muted-foreground">
                                            Changing the slug will update the tenant's login URL.
                                        </p>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="logo"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Logo URL</FormLabel>
                                        <FormControl>
                                            <Input placeholder="https://..." {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="status"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Status</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select a status" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="active">Active</SelectItem>
                                                <SelectItem value="disabled">Disabled</SelectItem>
                                                <SelectItem value="suspended">Suspended</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {form.formState.errors.root && (
                                <p className="text-sm font-medium text-destructive">
                                    {form.formState.errors.root.message}
                                </p>
                            )}

                            <div className="flex justify-end pt-4">
                                <Button type="submit" disabled={isUpdating}>
                                    {isUpdating ? "Saving..." : "Save Changes"}
                                </Button>
                            </div>
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
};
