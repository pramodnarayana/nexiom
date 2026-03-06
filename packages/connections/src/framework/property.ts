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
    auth?: any;
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
    defaultValue?: any;
};

export type DropdownProperty<T> = BasePropertySchema & {
    type: PropertyType.DROPDOWN;
    refreshers: string[];
    refreshOnSearch?: boolean;
    options: (...args: any[]) => Promise<any>;
    defaultValue?: T;
};

export type StaticDropdownProperty<T> = BasePropertySchema & {
    type: PropertyType.STATIC_DROPDOWN;
    options: {
        disabled?: boolean;
        placeholder?: string;
        options: { label: string; value: T }[];
    };
    defaultValue?: T;
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


export const AuthenticationType = { BEARER_TOKEN: 'BEARER_TOKEN', BASIC: 'BASIC', CUSTOM: 'CUSTOM', OAUTH2: 'OAUTH2' };

/**
 * Mocks the exact Activepieces Property namespace.
 * Used strictly for typing the input config schema of an Action.
 */
export const Property = {
    File<T = any>(request: any): any {
        return { ...request, type: PropertyType.FILE };
    },
    Array<T = any>(request: any): any {
        return { ...request, type: PropertyType.ARRAY };
    },
    Object<T = any>(request: any): any {
        return { ...request, type: PropertyType.OBJECT };
    },
    DateTime<T = any>(request: any): any {
        return { ...request, type: PropertyType.SHORT_TEXT };
    },
    DynamicProperties<T = any>(request: any): any {
        return { ...request, type: PropertyType.DYNAMIC };
    },
    MarkDown<T = any>(request: any): any {
        return { ...request, type: PropertyType.SHORT_TEXT };
    },
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
    Dropdown<T = any, R extends boolean = boolean, AuthT = any>(
        request: Omit<DropdownProperty<T>, 'type'>,
    ): DropdownProperty<T> {
        return { ...request, type: PropertyType.DROPDOWN };
    },
    StaticDropdown<T = any>(
        request: Omit<StaticDropdownProperty<T>, 'type'>,
    ): StaticDropdownProperty<T> {
        return { ...request, type: PropertyType.STATIC_DROPDOWN };
    },
};
