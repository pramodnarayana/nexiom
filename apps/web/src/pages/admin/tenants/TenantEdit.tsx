import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useUpdate, useOne } from "@refinedev/core";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";

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
        (data.logo !== undefined && data.logo !== "")
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

    if (isLoadingTenant) {
        return <div className="p-8">Loading...</div>; // Reverting to simple loading while I check/create Skeleton
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
                                        <FormLabel>Name</FormLabel>
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
