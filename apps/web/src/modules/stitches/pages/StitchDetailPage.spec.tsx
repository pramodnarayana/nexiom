import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StitchDetailPage } from './StitchDetailPage';
import { useStitchDetailPage } from '../hooks/useStitchDetailPage';

vi.mock('../hooks/useStitchDetailPage');
vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'ws-1', stitchId: '1' }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: any) => <>{children}</>,
}));
vi.mock('../components/MappingCanvas', () => ({ MappingCanvas: () => <div data-testid="mapping-canvas" /> }));
vi.mock('../components/SchedulePanel', () => ({ SchedulePanel: () => <div data-testid="schedule-panel" /> }));
vi.mock('../components/ConfigPanel', () => ({ ConfigPanel: () => <div data-testid="config-panel" /> }));

describe('StitchDetailPage', () => {
  it('renders loading state', () => {
    vi.mocked(useStitchDetailPage).mockReturnValue({
      workspaceId: '1',
      stitchId: '1',
      stitch: null,
      setStitch: vi.fn(),
      loading: true,
      error: null,
      activeTab: 'mappings',
      setActiveTab: vi.fn(),
      handleSaveStitchMeta: vi.fn(),
      isSavingMeta: false,
      handleSaveSchedule: vi.fn(),
      isSavingSchedule: false,
      canonicalMappings: [],
    } as any);

    render(<StitchDetailPage />);
    expect(screen.getByText('Loading execution context...')).toBeInTheDocument();
  });

  it('renders empty state on error', () => {
    vi.mocked(useStitchDetailPage).mockReturnValue({
      workspaceId: '1',
      stitchId: '1',
      stitch: null,
      setStitch: vi.fn(),
      loading: false,
      error: 'Failed to fetch',
      activeTab: 'mappings',
      setActiveTab: vi.fn(),
      handleSaveStitchMeta: vi.fn(),
      isSavingMeta: false,
      handleSaveSchedule: vi.fn(),
      isSavingSchedule: false,
      canonicalMappings: [],
    } as any);

    render(<StitchDetailPage />);
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
  });

  it('renders tabs when stitch is loaded', () => {
    vi.mocked(useStitchDetailPage).mockReturnValue({
      workspaceId: '1',
      stitchId: '1',
      stitch: { id: '1', name: 'Test Stitch', status: 'ACTIVE' } as any,
      setStitch: vi.fn(),
      loading: false,
      error: null,
      activeTab: 'mappings',
      setActiveTab: vi.fn(),
      handleSaveStitchMeta: vi.fn(),
      isSavingMeta: false,
      handleSaveSchedule: vi.fn(),
      isSavingSchedule: false,
      canonicalMappings: [],
    } as any);

    render(<StitchDetailPage />);
    expect(screen.getByText('Test Stitch')).toBeInTheDocument();
  });
});
