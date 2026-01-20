import type { NotificationProvider } from "@refinedev/core";
import { toast } from "@/hooks/use-toast";

export const notificationProvider: NotificationProvider = {
    open: ({ message, type, description }) => {
        toast({
            title: message,
            description: description,
            variant: type === "error" ? "destructive" : type === "success" ? "success" : type === "progress" ? "default" : "default",
        });
    },
    close: () => {
        // Shadcn toast handles its own dismissal via timeouts
    },
};
