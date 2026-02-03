import * as React from "react"
import { cn } from "@/shared/lib/utils"

const TabsContext = React.createContext<{
    activeTab: string
    setActiveTab: (value: string) => void
    getTabId: (value: string) => string
    getPanelId: (value: string) => string
} | null>(null)

interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
    defaultValue: string
    onValueChange?: (value: string) => void
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
    ({ className, defaultValue, onValueChange, children, ...props }, ref) => {
        const [activeTab, setActiveTabState] = React.useState(defaultValue)
        const uniqueId = React.useId()

        const setActiveTab = React.useCallback((value: string) => {
            setActiveTabState(value)
            onValueChange?.(value)
        }, [onValueChange])

        const getTabId = React.useCallback((value: string) => `${uniqueId}-tab-${value}`, [uniqueId])
        const getPanelId = React.useCallback((value: string) => `${uniqueId}-tabpanel-${value}`, [uniqueId])

        const contextValue = React.useMemo(() => ({
            activeTab,
            setActiveTab,
            getTabId,
            getPanelId
        }), [activeTab, setActiveTab, getTabId, getPanelId])

        return (
            <TabsContext.Provider value={contextValue}>
                <div ref={ref} className={cn("", className)} {...props}>
                    {children}
                </div>
            </TabsContext.Provider>
        )
    }
)
Tabs.displayName = "Tabs"

const TabsList = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div
        ref={ref}
        role="tablist"
        className={cn(
            "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
            className
        )}
        {...props}
    />
))
TabsList.displayName = "TabsList"

interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    value: string
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
    ({ className, value, onClick, onKeyDown, ...props }, ref) => {
        const context = React.useContext(TabsContext)
        if (!context) throw new Error("TabsTrigger must be used within Tabs")

        const isActive = context.activeTab === value

        const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
            // Basic keyboard navigation for tabs
            const currentButton = e.currentTarget
            const tablist = currentButton.parentElement
            if (!tablist) return

            // Query only enabled tabs for navigation
            const tabs = Array.from(tablist.querySelectorAll('[role="tab"]:not([disabled])'))
            const currentIndex = tabs.indexOf(currentButton)

            // If current button is somehow disabled (shouldn't happen with pointer-events-none but safe guard)
            if (currentIndex === -1) return

            let nextIndex: number

            switch (e.key) {
                case 'ArrowRight':
                case 'ArrowDown':
                    e.preventDefault()
                    nextIndex = (currentIndex + 1) % tabs.length
                    break
                case 'ArrowLeft':
                case 'ArrowUp':
                    e.preventDefault()
                    nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
                    break
                case 'Home':
                    e.preventDefault()
                    nextIndex = 0
                    break
                case 'End':
                    e.preventDefault()
                    nextIndex = tabs.length - 1
                    break
                default:
                    onKeyDown?.(e)
                    return
            }

            const nextTab = tabs[nextIndex] as HTMLButtonElement | undefined
            if (nextTab) {
                nextTab.focus()
                nextTab.click()
            }

            onKeyDown?.(e)
        }

        return (
            <button
                ref={ref}
                type="button"
                role="tab"
                id={context.getTabId(value)}
                tabIndex={isActive ? 0 : -1}
                aria-selected={isActive}
                aria-controls={context.getPanelId(value)}
                data-state={isActive ? "active" : "inactive"}
                className={cn(
                    "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                    isActive && "bg-background text-foreground shadow",
                    className
                )}
                onClick={(e) => {
                    context.setActiveTab(value)
                    onClick?.(e)
                }}
                onKeyDown={handleKeyDown}
                {...props}
            />
        )
    }
)
TabsTrigger.displayName = "TabsTrigger"

interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
    value: string
}

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
    ({ className, value, ...props }, ref) => {
        const context = React.useContext(TabsContext)
        if (!context) throw new Error("TabsContent must be used within Tabs")

        if (context.activeTab !== value) return null

        return (
            <div
                ref={ref}
                role="tabpanel"
                id={context.getPanelId(value)}
                aria-labelledby={context.getTabId(value)}
                className={cn(
                    "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    className
                )}
                {...props}
            />
        )
    }
)
TabsContent.displayName = "TabsContent"

export { Tabs, TabsList, TabsTrigger, TabsContent }
