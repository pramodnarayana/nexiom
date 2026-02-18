import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender } from '@testing-library/react';
import React from 'react';

export function createTestQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                cacheTime: Infinity,
            },
        },
    });
}

export function renderWithClient(ui: React.ReactNode) {
    const testQueryClient = createTestQueryClient();
    const { rerender, ...result } = rtlRender(
        <QueryClientProvider client={testQueryClient}>{ui}</QueryClientProvider>
    );
    return {
        ...result,
        rerender: (rerenderUi: React.ReactNode) =>
            rerender(
                <QueryClientProvider client={testQueryClient}>{rerenderUi}</QueryClientProvider>
            ),
    };
}
