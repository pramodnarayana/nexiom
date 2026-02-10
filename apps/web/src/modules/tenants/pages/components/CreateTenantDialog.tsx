import { Button } from "@/shared/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
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
import { Input } from "@/shared/components/ui/input";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCreate } from "@refinedev/core";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useToast } from "@/shared/hooks/use-toast";
import slugify from "slugify";

const CreateTenantSchema = z.object({
    name: z.string().min(1, "Company Name is required"),
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

    const [slugSuffix] = useState(() => crypto.randomUUID().slice(0, 4));
    const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

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
                    setSlugManuallyEdited(false); // Reset state
                    toast({
                        title: "Success",
                        description: "Tenant created successfully.",
                        variant: "default",
                    });
                },
                onError: (error: unknown) => {
                    const message = (error as Error)?.message || "Failed to create tenant.";
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
                                    <FormLabel>Company Name</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="Acme Corp"
                                            {...field}
                                            onChange={(e) => {
                                                const name = e.target.value;
                                                field.onChange(e);
                                                // Auto-generate slug from name with fixed random suffix if not manually edited
                                                if (name && !slugManuallyEdited) {
                                                    const cleanName = slugify(name, { lower: true, strict: true });
                                                    const generatedSlug = `${cleanName}-${slugSuffix}`;
                                                    form.setValue("slug", generatedSlug, { shouldValidate: true });
                                                } else if (!name && !slugManuallyEdited) {
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
                                        <Input
                                            placeholder="acme-corp"
                                            {...field}
                                            onChange={(e) => {
                                                field.onChange(e);
                                                setSlugManuallyEdited(true);
                                            }}
                                        />
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
