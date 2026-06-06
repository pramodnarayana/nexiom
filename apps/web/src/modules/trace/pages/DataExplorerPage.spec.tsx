import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DataExplorerPage } from './DataExplorerPage';
import { useDataExplorer } from '../hooks/useDataExplorer';
import { BrowserRouter } from 'react-router-dom';

vi.mock('../hooks/useDataExplorer');
vi.mock('../components/QueryBuilder', () => ({ QueryBuilder: () => <div data-testid="query-builder" /> }));
vi.mock('../components/JsonEditorModal', () => ({ JsonEditorModal: () => <div data-testid="json-editor" /> }));
vi.mock('../components/TraceViewerPanel', () => ({ TraceViewerPanel: () => <div data-testid="trace-viewer" /> }));
vi.mock('../hooks/useTabPanel', () => ({
  useTabPanel: () => ({
    page: 1,
    result: { data: [{ id: '1', status: 'SUCCESS' }], total: 1 },
    loading: false,
    error: null,
    showFilters: false,
    filters: { rules: [] },
    objectTypes: ['User'],
    objectType: 'User',
    LIMIT: 50,
  })
}));

describe('DataExplorerPage', () => {
  it('renders correctly when workspaceId is missing', () => {
    vi.mocked(useDataExplorer).mockReturnValue({
      workspaceId: undefined as any,
      activeTab: 'inbound',
      setActiveTab: vi.fn(),
      selectedStitch: null,
      setSelectedStitch: vi.fn(),
      stitches: [],
      isLoadingStitches: false,
      activeTabMeta: { id: 'inbound', label: 'Inbound', description: 'desc' } as any,
    });

    const { container } = render(<BrowserRouter><DataExplorerPage /></BrowserRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders prompt when no stitch is selected', () => {
    vi.mocked(useDataExplorer).mockReturnValue({
      workspaceId: 'ws-1',
      activeTab: 'inbound',
      setActiveTab: vi.fn(),
      selectedStitch: null,
      setSelectedStitch: vi.fn(),
      stitches: [{ id: 's1', name: 'Stitch 1' } as any],
      isLoadingStitches: false,
      activeTabMeta: { id: 'inbound', label: 'Inbound', description: 'desc' } as any,
    });

    render(<BrowserRouter><DataExplorerPage /></BrowserRouter>);
    expect(screen.getByText('Data Hub')).toBeInTheDocument();
    expect(screen.getByText(/Select a Stitch above/)).toBeInTheDocument();
  });

  it('renders TabPanel when a stitch is selected', () => {
    vi.mocked(useDataExplorer).mockReturnValue({
      workspaceId: 'ws-1',
      activeTab: 'inbound',
      setActiveTab: vi.fn(),
      selectedStitch: { id: 's1', name: 'Stitch 1' } as any,
      setSelectedStitch: vi.fn(),
      stitches: [{ id: 's1', name: 'Stitch 1' } as any],
      isLoadingStitches: false,
      activeTabMeta: { id: 'inbound', label: 'Inbound', description: 'desc' } as any,
    });

    render(<BrowserRouter><DataExplorerPage /></BrowserRouter>);
    expect(screen.getByText('1 total records')).toBeInTheDocument();
    expect(screen.getByText('SUCCESS')).toBeInTheDocument();
  });
});
