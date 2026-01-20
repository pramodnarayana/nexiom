import type { NotificationProvider } from "@refinedev/core";
import { toast } from "@/hooks/use-toast";

export const notificationProvider: NotificationProvider = {
    open: ({ message, type, description, key }) => {
        const { dismiss } = toast({
            title: message,
            description: description,
            variant: type === "error" ? "destructive" : type === "success" ? "success" : type === "progress" ? "default" : "default",
        });

        if (key) {
            toastDismissals.set(key, dismiss);
        }
    },
    close: (key) => {
        const dismiss = toastDismissals.get(key);
        if (dismiss) {
            dismiss();
            toastDismissals.delete(key);
        }
    },
};

const toastDismissals = new Map<string, () => void>();
