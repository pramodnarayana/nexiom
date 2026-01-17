import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardPage } from './DashboardPage';

describe('DashboardPage', () => {
    it('renders dashboard stats', () => {
        render(<DashboardPage />);
        expect(screen.getByText('Total Members')).toBeInTheDocument();
        expect(screen.getByText('Active Sessions')).toBeInTheDocument();
        expect(screen.getByText('Security Score')).toBeInTheDocument();
        expect(screen.getByText('Activity Feed')).toBeInTheDocument();
    });
});
