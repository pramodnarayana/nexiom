import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CreateStitchPage } from './CreateStitchPage';
import { useCreateStitchPage } from '../hooks/useCreateStitchPage';

vi.mock('../hooks/useCreateStitchPage');
vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'ws-1' }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: any) => <>{children}</>,
}));

describe('CreateStitchPage', () => {
  it('renders loading state', () => {
    vi.mocked(useCreateStitchPage).mockReturnValue({
      step: 1,
      setStep: vi.fn(),
      wizard: {
        name: '',
        srcDataSourceId: '',
        sourceObject: '',
        destDataSourceId: '',
        targetObject: '',
        mappingRules: [],
        syncConditions: [],
        config: {},
      },
      setWizard: vi.fn(),
      submitting: false,
      submitError: null,
      connections: [],
      connectionsLoading: true,
      connectionsError: null,
      srcObjects: [],
      srcObjectsLoading: false,
      srcObjectsError: null,
      destObjects: [],
      destObjectsLoading: false,
      destObjectsError: null,
      stitchesHref: '/workspaces/ws-1/stitches',
      handleSrcConnectionChange: vi.fn(),
      handleDestConnectionChange: vi.fn(),
      handleCreate: vi.fn(),
      handleMappingChange: vi.fn(),
      loadSrcObjects: vi.fn(),
      loadDestObjects: vi.fn(),
      step1Valid: false,
      step2Valid: false,
    } as any);

    render(<CreateStitchPage />);
    expect(screen.getByText(/Loading connections/i)).toBeInTheDocument();
  });

  it('renders step 1 form', () => {
    vi.mocked(useCreateStitchPage).mockReturnValue({
      step: 1,
      setStep: vi.fn(),
      wizard: {
        name: '',
        srcDataSourceId: '',
        sourceObject: '',
        destDataSourceId: '',
        targetObject: '',
        mappingRules: [],
        syncConditions: [],
        config: {},
      },
      setWizard: vi.fn(),
      submitting: false,
      submitError: null,
      connections: [{ id: 'c1', appName: 'Salesforce', displayName: 'SF', workspaceId: 'ws-1' }],
      connectionsLoading: false,
      connectionsError: null,
      srcObjects: [],
      srcObjectsLoading: false,
      srcObjectsError: null,
      destObjects: [],
      destObjectsLoading: false,
      destObjectsError: null,
      stitchesHref: '/workspaces/ws-1/stitches',
      handleSrcConnectionChange: vi.fn(),
      handleDestConnectionChange: vi.fn(),
      handleCreate: vi.fn(),
      handleMappingChange: vi.fn(),
      loadSrcObjects: vi.fn(),
      loadDestObjects: vi.fn(),
      step1Valid: false,
      step2Valid: false,
    } as any);

    render(<CreateStitchPage />);
    expect(screen.getByText('Stitch Name')).toBeInTheDocument();
  });
});
