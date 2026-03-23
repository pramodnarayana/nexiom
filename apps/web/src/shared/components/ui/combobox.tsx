"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { Check, ChevronsUpDown, Search } from "lucide-react"

import { cn } from "@/shared/lib/utils"
import { Input } from "./input"

export interface ComboboxOption {
  value: string
  label: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  className?: string
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Select an option",
  searchPlaceholder = "Search…",
  emptyMessage = "No results found.",
  disabled,
  className,
}: Readonly<ComboboxProps>) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listId = React.useId()
  const listRef = React.useRef<HTMLDivElement>(null)

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q),
    )
  }, [options, query])

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setQuery("")
      setActiveIndex(-1)
      // Focus the search input after the popover finishes opening
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }

  function handleSelect(optionValue: string) {
    onValueChange(optionValue)
    setOpen(false)
    setQuery("")
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
        break
      case "ArrowUp":
        e.preventDefault()
        if (filtered.length === 0) break
        setActiveIndex((i) => Math.max(i - 1, 0))
        break
      case "Enter":
        e.preventDefault()
        if (activeIndex >= 0 && filtered[activeIndex]) {
          handleSelect(filtered[activeIndex].value)
        }
        break
      case "Escape":
        setOpen(false)
        break
      case "Tab":
        setOpen(false)
        break
    }
  }

  // Keep the keyboard-active item scrolled into view
  React.useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return
    const items = listRef.current.querySelectorAll<HTMLElement>('[role="option"]')
    items[activeIndex]?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  // Reset active index whenever the query or filtered option set changes
  React.useEffect(() => {
    setActiveIndex(-1)
  }, [query, filtered])

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background",
            "focus:outline-none focus:ring-1 focus:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{value ? selectedLabel : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          // Match the trigger width exactly
          className="z-50 w-[--radix-popover-trigger-width] rounded-md border bg-popover text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2"
        >
          {/* ── Search bar ─────────────────────────────────────────────── */}
          <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Input
              ref={inputRef}
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={activeIndex >= 0 && filtered[activeIndex] ? `${listId}-opt-${activeIndex}` : undefined}
              aria-autocomplete="list"
              value={query}
              onChange={(e) => { setQuery(e.target.value) }}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className="h-7 border-0 p-0 shadow-none focus-visible:ring-0 text-sm"
            />
          </div>

          {/* ── Options list ───────────────────────────────────────────── */}
          {/*
            WAI-ARIA 1.2 combobox pattern: role="listbox" is correct here.
            A native <select> cannot host the search <Input> above, so the
            ARIA listbox/option roles are the specified accessible equivalent.
            Keyboard navigation is handled by the search input via
            aria-activedescendant; options also carry tabIndex={-1} and their
            own onKeyDown so they are directly activatable if focused.
          */}
          <div // NOSONAR: S6819 — WAI-ARIA 1.2 combobox requires role="listbox"; native <select> cannot embed a search input
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Options"
            className="max-h-60 overflow-y-auto p-1"
          >
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </p>
            ) : (
              filtered.map((option, index) => (
                <div // NOSONAR: S6819 — WAI-ARIA 1.2 combobox requires role="option"; tabIndex and onKeyDown satisfy focusability/keyboard requirements
                  key={option.value}
                  id={`${listId}-opt-${index}`}
                  role="option"
                  // tabIndex={-1} makes each option programmatically focusable
                  // (required for role="option" per ARIA spec).
                  tabIndex={-1}
                  aria-selected={option.value === value}
                  data-active={index === activeIndex ? "true" : undefined}
                  onMouseEnter={() => { setActiveIndex(index) }}
                  onClick={() => { handleSelect(option.value) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleSelect(option.value)
                    }
                  }}
                  className={cn(
                    "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none",
                    "hover:bg-accent hover:text-accent-foreground",
                    "data-[active]:bg-accent data-[active]:text-accent-foreground",
                    option.value === value && "font-medium",
                  )}
                >
                  <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
                    {option.value === value && <Check className="h-4 w-4" />}
                  </span>
                  {option.label}
                </div>
              ))
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
