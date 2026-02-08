import { useAuth } from '@/shared/lib/auth/context';
import { Card, CardContent } from '@/shared/components/ui/card';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/components/ui/form';
import { useToast } from '@/shared/hooks/use-toast';
import { useEffect } from 'react';

export function TenantSettingsPage() {
    const { user } = useAuth();

    // Guard: Should interact with the current organization context
    // Ideally use a useOrganization() hook, but useAuth gives us orgId
    const orgId = user?.organizationId;

    if (!orgId) {
        return <div className="p-8 text-center text-muted-foreground">You do not have an organization context.</div>;
    }

    return (
        <div className="container mx-auto py-8">
            <div className="space-y-4">
                <GeneralSettingsTab orgId={orgId} />
            </div>
        </div>
    );
}

const formSchema = z.object({
    name: z.string().min(1, 'Name is required'),
});

function GeneralSettingsTab({ orgId }: Readonly<{ orgId: string }>) {
    const { toast } = useToast();
    const queryClient = useQueryClient();


    // Fetch organization by ID
    const { data: org, isLoading, isError, error } = useQuery({
        queryKey: ['organization', orgId],
        queryFn: async () => {
            const res = await apiClient.get<{ id: string; name: string; slug: string }>(`/tenants/${orgId}`);
            return res.data;
        }
    });

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: '',
        },
    });

    // Update form values when data loads
    useEffect(() => {
        if (org) {
            form.reset({
                name: org.name,
            });
        }
    }, [org, form]);

    const mutation = useMutation({
        mutationFn: async (values: z.infer<typeof formSchema>) => {
            await apiClient.patch(`/tenants/${orgId}/details`, values);
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['organization', orgId] });
            toast({
                title: "Organization updated",
                description: "Your organization settings have been saved successfully.",
            });
        },
        onError: (err) => {
            toast({
                variant: "destructive",
                title: "Update failed",
                description: err instanceof Error ? err.message : "Failed to update organization",
            });
        },
    });

    function onSubmit(values: z.infer<typeof formSchema>) {
        mutation.mutate(values);
    }

    if (isError) {
        return (
            <div className="text-center py-8">
                <p className="text-destructive font-medium">Error loading organization</p>
                <p className="text-sm text-muted-foreground mt-2">
                    {error instanceof Error ? error.message : 'An unexpected error occurred'}
                </p>
            </div>
        );
    }

    if (isLoading) return <div>Loading...</div>;
    if (!org) return <div>Organization not found</div>;

    return (
        <Card>
            <CardContent>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Company Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Acme Corp" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <Button type="submit" disabled={mutation.isPending}>
                            {mutation.isPending ? "Saving..." : "Save"}
                        </Button>
                    </form>
                </Form>
            </CardContent>
        </Card>
    )
}
