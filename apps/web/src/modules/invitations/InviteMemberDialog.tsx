import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
    Dialog,
    DialogContent,
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCustomMutation } from "@refinedev/core";

// Schema matching Backend DTO
const inviteSchema = z.object({
    email: z.string().email("Invalid email address"),
    role: z.string().min(1, "Role is required"),
});

type InviteFormValues = z.infer<typeof inviteSchema>;

type InvitationResponse = {
    id: string;
    [key: string]: unknown;
};

export function InviteMemberDialog() {
    const [open, setOpen] = useState(false);
    const { toast } = useToast();
    const { mutate, isLoading } = useCustomMutation<InvitationResponse>();

    const form = useForm<InviteFormValues>({
        resolver: zodResolver(inviteSchema),
        defaultValues: {
            email: "",
            role: "member", // Default role
        },
    });

    const onSubmit = (data: InviteFormValues) => {
        mutate(
            {
                url: `${import.meta.env.VITE_API_URL}/invitations`,
                method: "post",
                values: data,
                successNotification: false,
                errorNotification: false,
            },
            {
                onSuccess: () => {
                    setOpen(false);
                    form.reset();
                    toast({
                        title: "Invitation Sent",
                        description: `Invitation sent to ${data.email}`,
                    });
                },
                onError: (error: { response?: { data?: { message?: string } }; message?: string }) => {
                    console.error(error);
                    toast({
                        variant: "destructive",
                        title: "Failed to send invitation",
                        description: error?.response?.data?.message || error.message || "An unknown error occurred",
                    });
                },
            }
        );
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-md shadow-indigo-200 transition-all duration-200">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Users
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Add New User</DialogTitle>
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
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select a role" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="member">Member</SelectItem>
                                            <SelectItem value="admin">Admin</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <DialogFooter>
                            <Button
                                type="submit"
                                disabled={isLoading}
                                className="w-full sm:w-auto bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-md shadow-indigo-200 transition-all duration-200"
                            >
                                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Send Invitation
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
