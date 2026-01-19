import { useTheme } from "@/lib/theme/useTheme";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Paintbrush } from "lucide-react";

export function ThemeSwitcher() {
    const { theme, setTheme, availableThemes } = useTheme();

    return (
        <div className="flex items-center gap-2">
            <Paintbrush className="h-4 w-4 text-muted-foreground" />
            <Select value={theme} onValueChange={setTheme}>
                <SelectTrigger className="w-[180px] h-8 text-xs">
                    <SelectValue placeholder="Select Theme" />
                </SelectTrigger>
                <SelectContent>
                    {availableThemes.map((t) => (
                        <SelectItem key={t.name} value={t.name} className="text-xs">
                            {t.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
