import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';
import { Textarea } from '@/shared/components/ui/textarea';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/shared/components/ui/form';
import { Copy, Check } from 'lucide-react';
import { type ReactElement, useState, useMemo, useEffect } from 'react';
import type { ProviderResponse, VendorParams } from '../api/connections.api';

type UiPropType =
    | 'SHORT_TEXT'
    | 'LONG_TEXT'
    | 'SECRET_TEXT'
    | 'NUMBER'
    | 'CHECKBOX'
    | 'DROPDOWN'
    | 'STATIC_DROPDOWN'
    | 'JSON';

const SUPPORTED_UI_PROP_TYPES = new Set<string>([
    'SHORT_TEXT', 'LONG_TEXT', 'SECRET_TEXT', 'NUMBER',
    'CHECKBOX', 'DROPDOWN', 'STATIC_DROPDOWN', 'JSON',
]);

function isSupportedUiPropType(type: string): type is UiPropType {
    return SUPPORTED_UI_PROP_TYPES.has(type);
}

interface UiSchemaProp {
    type: UiPropType;
    displayName?: string;
    description?: string;
    required?: boolean;
    defaultValue?: string | number | boolean;
    /** Options for DROPDOWN / STATIC_DROPDOWN */
    options?: { label: string; value: string }[];
    placeholder?: string;
}

// Build a Zod field definition for a single uiSchema property
function buildPropZodField(prop: UiSchemaProp, key: string): z.ZodTypeAny {
    if (prop.type === 'CHECKBOX') {
        return z.boolean().default((prop.defaultValue as boolean | undefined) ?? false);
    }
    if (prop.type === 'NUMBER') {
        // Preprocess '' → undefined before coercion so empty inputs are treated
        // as missing rather than 0. Inner schema is required or optional based on
        // prop.required so that empty required fields fail validation.
        const inner = prop.required ? z.coerce.number() : z.coerce.number().optional();
        const field = z.preprocess((v) => (v === '' ? undefined : v), inner);
        return prop.required ? field : field.optional();
    }
    if (prop.type === 'JSON') {
        // Preprocess: '' → undefined so optional JSON fields can be left blank
        // without triggering the refine. The refine only runs on non-empty strings.
        const field = z.preprocess(
            (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
            z.string().refine(
                (v) => { try { JSON.parse(v); return true; } catch { return false; } },
                { message: `${prop.displayName ?? key} must be valid JSON` },
            ).optional(),
        );
        return prop.required ? field : field.optional();
    }
    // SHORT_TEXT | LONG_TEXT | SECRET_TEXT | DROPDOWN | STATIC_DROPDOWN
    let field = z.string();
    if (prop.required) {
        field = field.min(1, `${prop.displayName ?? key} is required`) as unknown as z.ZodString;
    }

    // If the server explicitly declared a default value (e.g. environment: 'login'),
    // we MUST bind it into the zod schema so react-hook-form doesn't strip it
    // if the user submits without interacting with the input.
    if (prop.defaultValue !== undefined) {
        return field.default(String(prop.defaultValue));
    }

    return prop.required ? field : field.optional();
}

// Select the correct control for a uiSchema property
function renderFieldControl(prop: UiSchemaProp, field: { value: unknown; onChange: (v: unknown) => void }): ReactElement {
    if (prop.type === 'CHECKBOX') {
        return (
            <div className="flex items-center h-10">
                <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary focus:outline-none"
                    checked={!!field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                />
            </div>
        );
    }
    if (prop.type === 'DROPDOWN' || prop.type === 'STATIC_DROPDOWN') {
        // Activepieces Framework nests dropdown options as { options: { options: [...] } }
        // We handle both direct arrays and the nested structure.
        const rawOptions = prop.options;
        interface NestedOptions { options?: { label: string; value: string }[] | NestedOptions }
        interface NestedNestedOptions { options?: { options?: { label: string; value: string }[] } }

        let optionsBody: { label: string; value: string }[] = [];
        if (rawOptions && 'options' in rawOptions && Array.isArray((rawOptions as NestedOptions).options)) {
            optionsBody = (rawOptions as { options: { label: string; value: string }[] }).options;
        } else if (rawOptions && 'options' in rawOptions && !Array.isArray((rawOptions as NestedOptions).options) && Array.isArray((rawOptions as NestedNestedOptions).options?.options)) {
            optionsBody = (rawOptions as NestedNestedOptions).options!.options!;
        } else if (Array.isArray(rawOptions)) {
            optionsBody = rawOptions;
        }

        return (
            <Select value={(field.value as string) ?? ''} onValueChange={field.onChange}>
                <SelectTrigger>
                    <SelectValue placeholder={prop.placeholder ?? `Select ${prop.displayName ?? 'option'}`} />
                </SelectTrigger>
                <SelectContent>
                    {optionsBody.map((opt: { label: string; value: string }) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        );
    }
    if (prop.type === 'JSON') {
        return (
            <Textarea
                value={(field.value as string) ?? ''}
                placeholder={prop.placeholder ?? '{}'}
                className="font-mono text-xs min-h-[80px]"
                onChange={(e) => field.onChange(e.target.value)}
            />
        );
    }
    if (prop.type === 'LONG_TEXT') {
        return (
            <Textarea
                value={(field.value as string) ?? ''}
                placeholder={prop.placeholder}
                onChange={(e) => field.onChange(e.target.value)}
            />
        );
    }
    let inputType = 'text';
    if (prop.type === 'SECRET_TEXT') inputType = 'password';
    if (prop.type === 'NUMBER') inputType = 'number';
    return (
        <Input
            type={inputType}
            value={field.value === 0 ? '0' : (field.value as string | undefined) ?? ''}
            placeholder={prop.placeholder}
            onChange={(e) => {
                const raw = e.target.value;
                let coerced: string | number = raw;
                if (prop.type === 'NUMBER') {
                    coerced = raw === '' ? '' : Number(raw);
                }
                field.onChange(coerced);
            }}
        />
    );
}

// Create zod schema dynamically from uiSchema properties
function buildZodSchema(uiSchema?: Record<string, UiSchemaProp>) {
    const shape: Record<string, z.ZodTypeAny> = {
        connectionName: z.string().min(1, 'Connection name is required'),
        clientId: z.string().min(1, 'Client ID is required'),
        // Always required — /connectors/oauth-exchange always expects a non-empty secret.
        clientSecret: z.string().min(1, 'Client secret is required'),
    };

    if (uiSchema) {
        for (const [key, prop] of Object.entries(uiSchema as Record<string, { type: string } & Partial<UiSchemaProp>>)) {
            if (!isSupportedUiPropType(prop.type)) continue;
            shape[key] = buildPropZodField(prop as UiSchemaProp, key);
        }
    }

    return z.object(shape);
}

/** Extracts non-empty, non-null extra fields from a form value map into a flat primitive record.
 * Preserves the original boolean/number/string types so checkboxes and number fields round-trip. */
function buildVendorParams(rest: Record<string, unknown>): VendorParams {
    const params: VendorParams = {};
    for (const [key, val] of Object.entries(rest)) {
        if (val !== undefined && val !== null && val !== '') {
            if (typeof val === 'boolean' || typeof val === 'number') {
                params[key] = val;
            } else {
                params[key] = String(val);
            }
        }
    }
    return params;
}

export interface DynamicAuthFormProps {
    provider: ProviderResponse;
    callbackUrl: string;
    isUpdate?: boolean;
    defaultValues?: Record<string, unknown>;
    onCancel: () => void;
    onSubmit: (data: {
        connectionName: string;
        clientId: string;
        clientSecret: string;
        /** All vendor-specific form values (e.g. { environment: 'test' }) — preserves original types. */
        vendorParams: VendorParams;
    }) => void;
}

/**
 * Merges uiSchema default values into a base defaults object.
 * Skips props whose type is not in the supported union.
 */
function mergeUiSchemaDefaults(
    base: Record<string, unknown>,
    uiSchema: Record<string, unknown> | undefined,
): Record<string, unknown> {
    if (!uiSchema) return base;
    const merged = { ...base };
    for (const [key, rawProp] of Object.entries(uiSchema as Record<string, { type: string } & Partial<UiSchemaProp>>)) {
        if (!isSupportedUiPropType(rawProp.type)) continue;
        const prop = rawProp as UiSchemaProp;
        if (merged[key] === undefined && prop.defaultValue !== undefined) {
            merged[key] = prop.defaultValue;
        }
        if (prop.type === 'CHECKBOX' && merged[key] === undefined) {
            merged[key] = false;
        }
    }
    return merged;
}

export function DynamicAuthForm({ provider, callbackUrl, isUpdate = false, defaultValues, onCancel, onSubmit }: Readonly<DynamicAuthFormProps>) {
    const schema = useMemo(() => buildZodSchema(provider.uiSchema as Record<string, UiSchemaProp> | undefined), [provider.uiSchema]);

    // Inject default values from uiSchema definitions when not provided by existing DB values.
    const mergedDefaults = mergeUiSchemaDefaults({ ...defaultValues }, provider.uiSchema as Record<string, unknown> | undefined);

    const initialValues = useMemo(() => ({
        connectionName: provider.displayName,
        clientId: '',
        clientSecret: '',
        ...mergedDefaults, // DB/uiSchema values take priority
    }), [provider.displayName, mergedDefaults]);

    const form = useForm<z.infer<typeof schema>>({
        resolver: zodResolver(schema),
        defaultValues: initialValues,
    });

    // Re-hydrate the form when async credentials arrive (i.e. getConnectionCredentials resolves for an existing connection).
    useEffect(() => {
        if (!isUpdate) return;
        form.reset(initialValues);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [defaultValues, isUpdate]);

    const [copied, setCopied] = useState(false);
    const handleCopy = async () => {
        if (!callbackUrl) return;
        try {
            await navigator.clipboard.writeText(callbackUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.warn('[DynamicAuthForm] Clipboard write failed:', err);
        }
    };

    const handleValidSubmit = (values: z.infer<typeof schema>) => {
        const { connectionName, clientId, clientSecret, ...rest } = values;
        onSubmit({
            connectionName: connectionName as string,
            clientId: clientId as string,
            clientSecret: clientSecret as string,
            vendorParams: buildVendorParams(rest as Record<string, unknown>),
        });
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(handleValidSubmit)} className="space-y-4 py-4">

                <FormField
                    control={form.control}
                    name="connectionName"
                    render={({ field }) => (
                        <FormItem className="grid grid-cols-4 items-center gap-4 space-y-0">
                            <FormLabel className="text-right">Name <span className="text-red-500">*</span></FormLabel>
                            <div className="col-span-3">
                                <FormControl>
                                    <Input placeholder={`e.g. ${provider.displayName}`} {...field} value={field.value as string || ''} />
                                </FormControl>
                                <FormMessage />
                            </div>
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="clientId"
                    render={({ field }) => (
                        <FormItem className="grid grid-cols-4 items-center gap-4 space-y-0">
                            <FormLabel className="text-right">Client ID <span className="text-red-500">*</span></FormLabel>
                            <div className="col-span-3">
                                <FormControl>
                                    <Input {...field} value={field.value as string || ''} />
                                </FormControl>
                                <FormMessage />
                            </div>
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="clientSecret"
                    render={({ field }) => (
                        <FormItem className="grid grid-cols-4 items-center gap-4 space-y-0">
                            <FormLabel className="text-right">Client Secret <span className="text-red-500">*</span></FormLabel>
                            <div className="col-span-3">
                                <FormControl>
                                    <Input type="password" {...field} value={field.value as string || ''} placeholder={isUpdate ? '(Required — re-enter to reconnect)' : ''} />
                                </FormControl>
                                <FormMessage />
                            </div>
                        </FormItem>
                    )}
                />


                {/* Render Dynamic UI Schema properties — environment and other vendor-specific
                    fields are rendered generically here; no hardcoded field blocks needed. */}

                {provider.uiSchema && (Object.entries(provider.uiSchema as Record<string, UiSchemaProp>))
                    .filter(([, prop]) => isSupportedUiPropType(prop.type))
                    .map(([key, prop]) => {
                        return (
                            <FormField
                                key={key}
                                control={form.control}
                                name={key}
                                render={({ field }) => (
                                    <FormItem className="grid grid-cols-4 items-center gap-4 space-y-0">
                                        <FormLabel className="text-right">{prop.displayName || key} {prop.required && <span className="text-red-500">*</span>}</FormLabel>
                                        <div className="col-span-3">
                                            <FormControl>
                                                {renderFieldControl(prop, field)}
                                            </FormControl>
                                            {prop.description && <FormDescription className="mt-2">{prop.description}</FormDescription>}
                                            <FormMessage />
                                        </div>
                                    </FormItem>
                                )}
                            />
                        );
                    })}

                <div className="grid grid-cols-4 items-center gap-4 pt-2">
                    <Label className="text-right">Callback URL</Label>
                    <div className="col-span-3 flex items-center relative gap-2">
                        <Input
                            value={callbackUrl}
                            readOnly
                            className="bg-muted font-mono text-xs pr-10 truncate"
                            title="Copy this and paste it into the external app configuration"
                        />
                        <Button
                            size="icon"
                            variant="ghost"
                            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                            onClick={handleCopy}
                            type="button"
                            title="Copy to clipboard"
                        >
                            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4 text-muted-foreground" />}
                        </Button>
                    </div>
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t mt-4">
                    <Button type="button" variant="outline" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button type="submit">
                        {isUpdate ? 'Reconnect' : 'Connect'}
                    </Button>
                </div>
            </form>
        </Form>
    );
}
