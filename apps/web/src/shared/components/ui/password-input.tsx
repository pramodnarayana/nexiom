import * as React from "react"
import { Eye, EyeOff } from "lucide-react"

import { cn } from "@/shared/lib/utils"
import { Button } from "@/shared/components/ui/button"
import { Input } from "@/shared/components/ui/input"

const PasswordInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    ({ className, ...props }, ref) => {
        const [showPassword, setShowPassword] = React.useState(false)

        return (
            <div className="relative">
                <Input
                    className={cn("pr-10", className)}
                    ref={ref}
                    {...props}
                    type={showPassword ? "text" : "password"}
                />
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowPassword((prev) => !prev)}
                    tabIndex={-1} // Skip tab index for the button
                >
                    {showPassword ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span className="sr-only">
                        {showPassword ? "Hide password" : "Show password"}
                    </span>
                </Button>
            </div>
        )
    }
)
PasswordInput.displayName = "PasswordInput"

export { PasswordInput }
