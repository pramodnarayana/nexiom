import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/shared/components/ui/form';
import { Copy, Check } from 'lucide-react';
import { useState, useMemo } from 'react';
import type { ProviderResponse } from '../api/connections.api';

type UiPropType = 'SHORT_TEXT' | 'LONG_TEXT' | 'SECRET_TEXT' | 'NUMBER' | 'CHECKBOX';

interface UiSchemaProp {
    type: UiPropType;
    displayName?: string;
    description?: string;
    required?: boolean;
    defaultValue?: string | number | boolean;
}

// Build a Zod field definition for a single uiSchema property
function buildPropZodField(prop: UiSchemaProp, key: string): z.ZodTypeAny {
    if (prop.type === 'CHECKBOX') {
        return z.boolean().default((prop.defaultValue as boolean | undefined) ?? false);
    }
    if (prop.type === 'NUMBER') {
        const field = z.coerce.number();
        return prop.required ? field : field.optional();
    }
    // SHORT_TEXT | LONG_TEXT | SECRET_TEXT
    const field = z.string();
    if (prop.required) return field.min(1, `${prop.displayName ?? key} is required`);
    return (field).optional();
}

// Select the correct <Input> variant for a uiSchema property
function renderFieldControl(prop: UiSchemaProp, field: { value: unknown; onChange: (v: unknown) => void }): React.ReactElement {
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
    let inputType = 'text';
    if (prop.type === 'SECRET_TEXT') inputType = 'password';
    if (prop.type === 'NUMBER') inputType = 'number';
    return <Input type={inputType} onChange={field.onChange} value={(field.value as string) || ''} />;
}

// Create zod schema dynamically from uiSchema properties
function buildZodSchema(uiSchema?: Record<string, UiSchemaProp>, isUpdate: boolean = false) {
    const shape: Record<string, z.ZodTypeAny> = {
        connectionName: z.string().min(1, 'Connection name is required'),
        clientId: z.string().min(1, 'Client ID is required'),
    };

    // In update mode, clientSecret isn't strictly required (often omitted to keep existing)
    shape.clientSecret = isUpdate ? z.string().optional() : z.string().min(1, 'Client secret is required');
    shape.env = z.string().optional();

    if (uiSchema) {
        for (const [key, prop] of Object.entries(uiSchema)) {
            shape[key] = buildPropZodField(prop, key);
        }
    }

    return z.object(shape);
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
        clientSecret?: string;
        env?: string;
        vendorParams: Record<string, string>;
    }) => void;
}

export function DynamicAuthForm({ provider, callbackUrl, isUpdate = false, defaultValues, onCancel, onSubmit }: Readonly<DynamicAuthFormProps>) {
    const schema = useMemo(() => buildZodSchema(provider.uiSchema as Record<string, UiSchemaProp> | undefined, isUpdate), [provider.uiSchema, isUpdate]);

    // Inject default values out of uiSchema definitions if not provided by existing values
    const mergedDefaults = { ...defaultValues };
    if (provider.uiSchema) {
        for (const [key, prop] of Object.entries(provider.uiSchema as Record<string, UiSchemaProp>)) {
            if (mergedDefaults[key] === undefined && prop.defaultValue !== undefined) {
                mergedDefaults[key] = prop.defaultValue;
            }
            if (prop.type === 'CHECKBOX' && mergedDefaults[key] === undefined) {
                mergedDefaults[key] = false;
            }
        }
    }

    const form = useForm<z.infer<typeof schema>>({
        resolver: zodResolver(schema),
        defaultValues: {
            connectionName: provider.displayName,
            clientId: '',
            clientSecret: '',
            env: provider.environments?.[0]?.name,
            ...mergedDefaults
        },
    });

    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        if (!callbackUrl) return;
        navigator.clipboard.writeText(callbackUrl).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handleValidSubmit = (values: z.infer<typeof schema>) => {
        const { connectionName, clientId, clientSecret, env, ...rest } = values;
        // Everything else belongs to vendorParams
        const vendorParams: Record<string, string> = {};
        for (const [key, val] of Object.entries(rest)) {
            if (val !== undefined && val !== null && val !== '') {
                vendorParams[key] = String(val);
            }
        }

        onSubmit({
            connectionName: connectionName as string,
            clientId: clientId as string,
            clientSecret: clientSecret as string | undefined,
            env: env as string | undefined,
            vendorParams,
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
                            <FormLabel className="text-right">Client Secret {!isUpdate && <span className="text-red-500">*</span>}</FormLabel>
                            <div className="col-span-3">
                                <FormControl>
                                    <Input type="password" {...field} value={field.value as string || ''} placeholder={isUpdate ? '(Unchanged)' : ''} />
                                </FormControl>
                                <FormMessage />
                            </div>
                        </FormItem>
                    )}
                />

                {provider.environments && provider.environments.length > 0 && (
                    <FormField
                        control={form.control}
                        name="env"
                        render={({ field }) => (
                            <FormItem className="grid grid-cols-4 items-center gap-4 space-y-0">
                                <FormLabel className="text-right">Environment</FormLabel>
                                <div className="col-span-3">
                                    <Select onValueChange={field.onChange} defaultValue={field.value as string}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select environment" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {provider.environments!.map((e) => (
                                                <SelectItem key={e.name} value={e.name}>
                                                    {e.displayName}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </div>
                            </FormItem>
                        )}
                    />
                )}

                {/* Render Dynamic UI Schema properties */}
                {provider.uiSchema && (Object.entries(provider.uiSchema as Record<string, UiSchemaProp>)).map(([key, prop]) => {
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
