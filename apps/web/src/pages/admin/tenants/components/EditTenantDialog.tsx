import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
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
import { useUpdate } from "@refinedev/core";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

const UpdateTenantSchema = z.object({
    name: z.string().min(1, "Name is required").optional(),
    slug: z.string().min(3, "Slug must be at least 3 chars").regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, and hyphens only").optional(),
    logo: z.string().url("Must be a valid URL").optional().or(z.literal("")),
    status: z.enum(["active", "disabled", "suspended"]).optional(),
});

type UpdateTenantFormValues = z.infer<typeof UpdateTenantSchema>;

interface EditTenantDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tenant: {
        id: string;
        name: string;
        slug: string | null;
        logo?: string;
        status: "active" | "disabled" | "suspended";
    } | null;
}

export const EditTenantDialog = ({ open, onOpenChange, tenant }: EditTenantDialogProps) => {
    const { mutate, isLoading } = useUpdate();
    const { toast } = useToast();

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

    // Reset form when tenant changes or dialog opens
    useEffect(() => {
        if (tenant && open) {
            reset({
                name: tenant.name,
                slug: tenant.slug || "",
                logo: tenant.logo || "",
                status: tenant.status,
            });
        }
    }, [tenant, reset, open]);

    const onSubmit = (values: UpdateTenantFormValues) => {
        if (!tenant?.id) return;

        mutate(
            {
                resource: "admin/tenants",
                id: tenant.id,
                values,
            },
            {
                onSuccess: () => {
                    onOpenChange(false);
                    toast({
                        title: "Success",
                        description: "Tenant updated successfully.",
                        variant: "default",
                    });
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Edit Tenant</DialogTitle>
                    <DialogDescription>
                        Update organization details and status.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Acme Corp" {...field} />
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
                        <DialogFooter>
                            <Button type="submit" disabled={isLoading}>
                                {isLoading ? "Saving..." : "Save Changes"}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};
