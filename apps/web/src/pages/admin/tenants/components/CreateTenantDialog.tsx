import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
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
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCreate } from "@refinedev/core";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import slugify from "slugify";

const CreateTenantSchema = z.object({
    name: z.string().min(1, "Name is required"),
    slug: z.string().min(3, "Slug must be at least 3 chars").regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, and hyphens only"),
    logo: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

type CreateTenantFormValues = z.infer<typeof CreateTenantSchema>;

export const CreateTenantDialog = () => {
    const [open, setOpen] = useState(false);
    const { mutate, isLoading } = useCreate();
    const { toast } = useToast();

    const form = useForm<CreateTenantFormValues>({
        resolver: zodResolver(CreateTenantSchema),
        defaultValues: {
            name: "",
            slug: "",
            logo: "",
        },
    });

    const onSubmit = (values: CreateTenantFormValues) => {
        mutate(
            {
                resource: "admin/tenants",
                values,
                invalidates: ['all'],
            },
            {
                onSuccess: () => {
                    setOpen(false);
                    form.reset();
                    toast({
                        title: "Success",
                        description: "Tenant created successfully.",
                        variant: "default",
                    });
                },
                onError: (error: unknown) => {
                    const message = (error as Error)?.message || "Failed to create tenant.";
                    // Check for common unique constraint error text or status if available
                    // Assuming Refine/Axios error structure.
                    // If backend returns specific message about slug, use it.
                    // Otherwise hint at slug uniqueness.
                    toast({
                        title: "Error Creating Tenant",
                        description: message.includes("Unique constraint") || message.includes("already exists")
                            ? "A tenant with this slug may already exist. Please modify the slug."
                            : message,
                        variant: "destructive",
                    });
                },
            }
        );
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Tenant
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Create Tenant</DialogTitle>
                    <DialogDescription>
                        Add a new tenant to the platform.
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
                                        <Input
                                            placeholder="Acme Corp"
                                            {...field}
                                            onChange={(e) => {
                                                const name = e.target.value;
                                                field.onChange(e);
                                                // Auto-generate slug from name with random suffix
                                                if (name) {
                                                    const cleanName = slugify(name, { lower: true, strict: true });
                                                    const suffix = crypto.randomUUID().slice(0, 4);
                                                    const generatedSlug = `${cleanName}-${suffix}`;
                                                    form.setValue("slug", generatedSlug, { shouldValidate: true });
                                                } else {
                                                    form.setValue("slug", "", { shouldValidate: true });
                                                }
                                            }}
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
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="logo"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Logo URL (Optional)</FormLabel>
                                    <FormControl>
                                        <Input placeholder="https://..." {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <DialogFooter>
                            <Button type="submit" disabled={isLoading}>
                                {isLoading ? "Creating..." : "Create Tenant"}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};
