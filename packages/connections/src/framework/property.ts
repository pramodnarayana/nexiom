export enum PropertyType {
    SHORT_TEXT = 'SHORT_TEXT',
    LONG_TEXT = 'LONG_TEXT',
    DROPDOWN = 'DROPDOWN',
    STATIC_DROPDOWN = 'STATIC_DROPDOWN',
    NUMBER = 'NUMBER',
    CHECKBOX = 'CHECKBOX',
    OAUTH2 = 'OAUTH2',
    SECRET_TEXT = 'SECRET_TEXT',
    ARRAY = 'ARRAY',
    OBJECT = 'OBJECT',
    JSON = 'JSON',
    MULTI_SELECT_DROPDOWN = 'MULTI_SELECT_DROPDOWN',
    STATIC_MULTI_SELECT_DROPDOWN = 'STATIC_MULTI_SELECT_DROPDOWN',
    DYNAMIC = 'DYNAMIC',
    FILE = 'FILE',
    CUSTOM_AUTH = 'CUSTOM_AUTH',
}

export type BasePropertySchema = {
    displayName: string;
    description?: string;
    required: boolean;
};

export type ShortTextProperty = BasePropertySchema & {
    type: PropertyType.SHORT_TEXT;
    defaultValue?: string;
};

export type LongTextProperty = BasePropertySchema & {
    type: PropertyType.LONG_TEXT;
    defaultValue?: string;
};

export type SecretTextProperty = BasePropertySchema & {
    type: PropertyType.SECRET_TEXT;
};

export type CheckboxProperty = BasePropertySchema & {
    type: PropertyType.CHECKBOX;
    defaultValue?: boolean;
};

export type NumberProperty = BasePropertySchema & {
    type: PropertyType.NUMBER;
    defaultValue?: number;
};

export type JsonProperty = BasePropertySchema & {
    type: PropertyType.JSON;
    defaultValue?: Record<string, unknown>;
};

export type DropdownProperty<T> = BasePropertySchema & {
    type: PropertyType.DROPDOWN;
    refreshers: string[];
    options: (propsValue: Record<string, unknown>) => Promise<{
        disabled?: boolean;
        placeholder?: string;
        options: { label: string; value: T }[];
    }>;
};

export type StaticDropdownProperty<T> = BasePropertySchema & {
    type: PropertyType.STATIC_DROPDOWN;
    options: {
        disabled?: boolean;
        placeholder?: string;
        options: { label: string; value: T }[];
    };
};

export type AnyProperty =
    | ShortTextProperty
    | LongTextProperty
    | SecretTextProperty
    | CheckboxProperty
    | NumberProperty
    | JsonProperty
    | DropdownProperty<unknown>
    | StaticDropdownProperty<unknown>;

/**
 * Mocks the exact Activepieces Property namespace.
 * Used strictly for typing the input config schema of an Action.
 */
export const Property = {
    ShortText(request: Omit<ShortTextProperty, 'type'>): ShortTextProperty {
        return { ...request, type: PropertyType.SHORT_TEXT };
    },
    LongText(request: Omit<LongTextProperty, 'type'>): LongTextProperty {
        return { ...request, type: PropertyType.LONG_TEXT };
    },
    Checkbox(request: Omit<CheckboxProperty, 'type'>): CheckboxProperty {
        return { ...request, type: PropertyType.CHECKBOX };
    },
    Number(request: Omit<NumberProperty, 'type'>): NumberProperty {
        return { ...request, type: PropertyType.NUMBER };
    },
    Json(request: Omit<JsonProperty, 'type'>): JsonProperty {
        return { ...request, type: PropertyType.JSON };
    },
    SecretText(request: Omit<SecretTextProperty, 'type'>): SecretTextProperty {
        return { ...request, type: PropertyType.SECRET_TEXT };
    },
    Dropdown<T>(
        request: Omit<DropdownProperty<T>, 'type'>,
    ): DropdownProperty<T> {
        return { ...request, type: PropertyType.DROPDOWN };
    },
    StaticDropdown<T>(
        request: Omit<StaticDropdownProperty<T>, 'type'>,
    ): StaticDropdownProperty<T> {
        return { ...request, type: PropertyType.STATIC_DROPDOWN };
    },
    File(request: any): any { return { ...request, type: PropertyType.FILE }; },
    Array(request: any): any { return { ...request, type: 'ARRAY' }; },
    Object(request: any): any { return { ...request, type: 'OBJECT' }; },
    DateTime(request: any): any { return { ...request, type: 'DATE_TIME' }; },
    DynamicProperties(request: any): any { return { ...request, type: 'DYNAMIC' }; },
    MultiSelectDropdown(request: any): any { return { ...request, type: 'MULTI_SELECT_DROPDOWN' }; },
    StaticMultiSelectDropdown(request: any): any { return { ...request, type: 'STATIC_MULTI_SELECT_DROPDOWN' }; },
    OAuth2(request: any): any { return { ...request, type: 'OAUTH2' }; },
    CustomAuth(request: any): any { return { ...request, type: 'CUSTOM_AUTH' }; },
    Dictionary(request: any): any { return { ...request, type: 'DICTIONARY' }; },
    MarkDown(request: any): any { return { ...request, type: 'MARKDOWN' }; },
};
