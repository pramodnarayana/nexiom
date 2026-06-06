import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StitchesPage } from './StitchesPage';
import { useStitchesPage } from '../hooks/useStitchesPage';

vi.mock('../hooks/useStitchesPage');
vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'ws-1' }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: any) => <>{children}</>,
}));

describe('StitchesPage', () => {
  it('renders loading state', () => {
    vi.mocked(useStitchesPage).mockReturnValue({
      workspaceId: '1',
      stitches: [],
      loading: true,
      error: null,
      deleteTarget: null,
      setDeleteTarget: vi.fn(),
      deleting: false,
      handleDeleteConfirm: vi.fn(),
      handleToggleStatus: vi.fn(),
    } as any);

    render(<StitchesPage />);
    expect(screen.getByText('Loading stitches…')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    vi.mocked(useStitchesPage).mockReturnValue({
      workspaceId: '1',
      stitches: [],
      loading: false,
      error: null,
      deleteTarget: null,
      setDeleteTarget: vi.fn(),
      deleting: false,
      handleDeleteConfirm: vi.fn(),
      handleToggleStatus: vi.fn(),
    } as any);

    render(<StitchesPage />);
    expect(screen.getByText('No stitches yet.')).toBeInTheDocument();
  });
});
