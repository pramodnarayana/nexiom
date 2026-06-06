import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WorkspacesPage } from './WorkspacesPage';
import { useWorkspacesPage } from '../hooks/useWorkspacesPage';
import { BrowserRouter } from 'react-router-dom';

vi.mock('../hooks/useWorkspacesPage');
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useOutletContext: () => ({ refreshWorkspaces: vi.fn() }),
  };
});

describe('WorkspacesPage', () => {
  it('renders loading state', () => {
    vi.mocked(useWorkspacesPage).mockReturnValue({
      workspaces: [],
      loading: true,
      error: null,
      dialogOpen: false,
      setDialogOpen: vi.fn(),
      creating: false,
      newName: '',
      setNewName: vi.fn(),
      newEnvType: 'PRODUCTION',
      setNewEnvType: vi.fn(),
      deleteTarget: null,
      setDeleteTarget: vi.fn(),
      deleting: false,
      handleCreate: vi.fn(),
      handleDeleteConfirm: vi.fn(),
    });

    render(<BrowserRouter><WorkspacesPage /></BrowserRouter>);
    expect(screen.getByText('Loading workspaces…')).toBeInTheDocument();
  });

  it('renders error state', () => {
    vi.mocked(useWorkspacesPage).mockReturnValue({
      workspaces: [],
      loading: false,
      error: 'Failed to fetch',
      dialogOpen: false,
      setDialogOpen: vi.fn(),
      creating: false,
      newName: '',
      setNewName: vi.fn(),
      newEnvType: 'PRODUCTION',
      setNewEnvType: vi.fn(),
      deleteTarget: null,
      setDeleteTarget: vi.fn(),
      deleting: false,
      handleCreate: vi.fn(),
      handleDeleteConfirm: vi.fn(),
    });

    render(<BrowserRouter><WorkspacesPage /></BrowserRouter>);
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    vi.mocked(useWorkspacesPage).mockReturnValue({
      workspaces: [],
      loading: false,
      error: null,
      dialogOpen: false,
      setDialogOpen: vi.fn(),
      creating: false,
      newName: '',
      setNewName: vi.fn(),
      newEnvType: 'PRODUCTION',
      setNewEnvType: vi.fn(),
      deleteTarget: null,
      setDeleteTarget: vi.fn(),
      deleting: false,
      handleCreate: vi.fn(),
      handleDeleteConfirm: vi.fn(),
    });

    render(<BrowserRouter><WorkspacesPage /></BrowserRouter>);
    expect(screen.getByText('No workspaces yet')).toBeInTheDocument();
  });

  it('renders workspaces list', () => {
    vi.mocked(useWorkspacesPage).mockReturnValue({
      workspaces: [{ id: '1', name: 'Prod Workspace', envType: 'PRODUCTION' } as any],
      loading: false,
      error: null,
      dialogOpen: false,
      setDialogOpen: vi.fn(),
      creating: false,
      newName: '',
      setNewName: vi.fn(),
      newEnvType: 'PRODUCTION',
      setNewEnvType: vi.fn(),
      deleteTarget: null,
      setDeleteTarget: vi.fn(),
      deleting: false,
      handleCreate: vi.fn(),
      handleDeleteConfirm: vi.fn(),
    });

    render(<BrowserRouter><WorkspacesPage /></BrowserRouter>);
    expect(screen.getByText('Prod Workspace')).toBeInTheDocument();
    expect(screen.getByText('PRODUCTION')).toBeInTheDocument();
  });
});
