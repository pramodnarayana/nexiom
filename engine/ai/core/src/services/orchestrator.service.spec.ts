/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { OrchestratorService } from './orchestrator.service.js';
import { PinoLogger } from 'nestjs-pino';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { TokenManagerService } from '@nexiom/credentials';
import { PieceRegistryService, MetadataDiscoveryService } from '@nexiom/piece-registry';

describe('OrchestratorService - Enterprise Hardened', () => {
  let service: OrchestratorService;

  beforeEach(async () => {
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      setContext: vi.fn(),
    };
    const mockDb = {
      select: vi.fn(),
      from: vi.fn(),
      leftJoin: vi.fn(),
      where: vi.fn(),
    };
    const mockTokenManager = { getValidCredentials: vi.fn() };
    const mockPieceRegistry = { getPiece: vi.fn(), getAction: vi.fn() };
    const mockMetadataDiscovery = {
      discoverRelationships: vi.fn(),
      describeObjects: vi.fn(),
      describeRelatedObjects: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrchestratorService,
        { provide: PinoLogger, useValue: mockLogger },
        { provide: DATABASE_CONNECTION, useValue: mockDb },
        { provide: TokenManagerService, useValue: mockTokenManager },
        { provide: PieceRegistryService, useValue: mockPieceRegistry },
        { provide: MetadataDiscoveryService, useValue: mockMetadataDiscovery },
      ],
    }).compile();

    service = module.get<OrchestratorService>(OrchestratorService);
  });

  it('should explicitly limit string sizes to 300 characters inside payload optimization', () => {
    const bloatedPayload = {
      Name: 'Testing 300 char optimization',
      LongField: 'A'.repeat(5000),
    };
    const result = (service as any).optimizePayloadTokens(bloatedPayload);
    expect(result.Name).toBe('Testing 300 char optimization');
    expect(result.LongField.length).toBe(310);
    expect(result.LongField).toContain('...[TRUNC]');
  });

  it('should forcefully cap 1:N relations arrays strictly to 2 items to prevent JSON bloat', () => {
    const arrayAttack = {
      Items: [
        { id: 1 },
        { id: 2 },
        { id: 3 },
        { id: 4 },
        { id: 5 },
        { id: 6 },
        { id: 7 },
      ],
    };
    const result = (service as any).optimizePayloadTokens(arrayAttack);
    expect(result.Items.length).toBe(2);
    expect(result.Items[0].id).toBe(1);
    expect(result.Items[1].id).toBe(2);
  });

  it('should completely eviscerate enterprise noise channels out of the payload', () => {
    const payload = {
      Id: '123',
      SystemModstamp: '2024',
      CurrencyIsoCode: 'USD',
      LastModifiedById: 'admin',
      ValidField: 'yes',
    };
    const result = (service as any).optimizePayloadTokens(payload);
    expect(result.Id).toBe('123'); // Standard keys pass
    expect(result.ValidField).toBe('yes');
    // System fields are strictly deleted in place
    expect(result.SystemModstamp).toBeUndefined();
    expect(result.CurrencyIsoCode).toBeUndefined();
    expect(result.LastModifiedById).toBeUndefined();
  });

  it('streamChat should immediately throw BadRequestException if no active connections exist for the requested org', async () => {
    // Override db to return empty array for connections
    const dbSpy = vi.spyOn((service as any).db, 'select').mockReturnValue({
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]), // No active connections
    });

    await expect(
      service.streamChat([], 'org-123', 'trace-id'),
    ).rejects.toThrowError(
      'No active app connections found. Please connect at least one app in Settings',
    );
  });

  it('streamChat should throw BadRequestException if active connections exist but yield zero usable tools (expired credentials)', async () => {
    // Mock 1 active connection, but TokenManager throws an error (e.g. invalid refresh token)
    const dbSpy = vi.spyOn((service as any).db, 'select').mockReturnValue({
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi
        .fn()
        .mockResolvedValue([
          { id: 'conn-1', appName: 'salesforce', displayName: 'SF' },
        ]),
    });

    vi.spyOn((service as any).pieceRegistry, 'getPiece').mockReturnValue({
      actions: {},
    });
    vi.spyOn(
      (service as any).tokenManager,
      'getValidCredentials',
    ).mockRejectedValue(new Error('Auth failed'));

    await expect(
      service.streamChat([], 'org-123', 'trace-id'),
    ).rejects.toThrowError(
      'Unable to initialise AI tools. All connections may have expired credentials',
    );
  });

  it('resolveFetchAction should heuristically match "get by ID" actions for the specified object type', () => {
    const mockPiece = {
      actions: {
        getLoad: { name: 'getLoad', displayName: 'Get Load Route' },
        createLoad: { name: 'createLoad', displayName: 'Create Load' },
        getInvoice: { name: 'getInvoice', displayName: 'Get Invoice' },
      },
    };

    // Explicitly targets the matched action
    const match = (service as any).resolveFetchAction(mockPiece, 'Load');
    expect(match.name).toBe('getLoad');
  });

  it('resolveFetchAction should fall back gracefully to searching displayName or return null if completely untrackable', () => {
    const mockPiece = {
      actions: {
        trigger: {
          name: 'get_asset',
          displayName: 'Get Specific Tracking Asset',
        },
      },
    };

    const match = (service as any).resolveFetchAction(mockPiece, 'Asset');
    expect(match.name).toBe('get_asset');

    const miss = (service as any).resolveFetchAction(mockPiece, 'UnknownBlob');
    expect(miss).toBeNull();
  });

  it('buildActionTools should correctly map piece actions natively into Gemini tool declarations', () => {
    const mockTools: Record<string, any> = {};
    const mockPiece = {
      actions: {
        updateInvoice: {
          name: 'updateInvoice',
          displayName: 'Update Invoice',
          description: 'Updates an invoice.',
          props: {},
        },
      },
    };
    const mockConn = { appName: 'quickbooks', displayName: 'QB', id: 'qb-1' };

    (service as any).buildActionTools(
      mockTools,
      mockPiece,
      mockConn,
      {},
      'trace-id',
    );

    expect(mockTools['quickbooks_qb-1_updateInvoice']).toBeDefined();
    expect(mockTools['quickbooks_qb-1_updateInvoice'].description).toContain(
      'Updates an invoice.',
    );
  });

  it('buildActionTools execution should cleanly invoke the piece action and return wrapped success', async () => {
    const mockTools: Record<string, any> = {};
    const mockActionRun = vi
      .fn()
      .mockResolvedValue({ id: 'inv-123', status: 'PAID' });
    const mockPiece = {
      actions: {
        updateInvoice: {
          name: 'updateInvoice',
          description: 'Update',
          props: {},
          run: mockActionRun,
        },
      },
    };
    const mockConn = { appName: 'quickbooks', displayName: 'QB', id: 'qb-1' };

    (service as any).buildActionTools(
      mockTools,
      mockPiece,
      mockConn,
      { token: '123' },
      'trace-id',
    );
    const result = await mockTools['quickbooks_qb-1_updateInvoice'].execute({
      id: 'inv-123',
      confirmed: true,
    });

    expect(result.success).toBe(true);
    expect(result.connectionName).toBe('connection-qb-1');
    expect(result.data.status).toBe('PAID');
    expect(mockActionRun).toHaveBeenCalledWith({
      auth: { token: '123' },
      propsValue: { id: 'inv-123', confirmed: true },
    });
  });

  it('buildActionTools execution should smoothly trap piece errors without crashing the pipeline', async () => {
    const mockTools: Record<string, any> = {};
    const mockActionRun = vi
      .fn()
      .mockRejectedValue(new Error('Quickbooks rate limited'));
    const mockPiece = {
      actions: {
        updateInvoice: {
          name: 'updateInvoice',
          description: 'Update',
          props: {},
          run: mockActionRun,
        },
      },
    };
    const mockConn = { appName: 'quickbooks', displayName: 'QB', id: 'qb-1' };

    (service as any).buildActionTools(
      mockTools,
      mockPiece,
      mockConn,
      {},
      'trace-id',
    );
    const result = await mockTools['quickbooks_qb-1_updateInvoice'].execute({
      id: 'inv-123',
      confirmed: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Action failed: Quickbooks rate limited');
  });

  it('buildHydratorTool should generate the universal relationship metadata tool if supported by the piece', () => {
    const mockTools: Record<string, any> = {};
    const mockPiece = {
      describeRelatedObjects: vi.fn(), // Tool only mounts if this exists natively
    };
    const mockConn = { appName: 'salesforce', displayName: 'SFDC', id: 'sf-1' };

    (service as any).buildHydratorTool(
      mockTools,
      mockPiece,
      mockConn,
      {},
      'trace-id',
      'tenant-1',
    );

    expect(mockTools['salesforce_sf-1_getEntityWithRelations']).toBeDefined();
    expect(
      mockTools['salesforce_sf-1_getEntityWithRelations'].description,
    ).toContain('Fetches a');
  });

  it('buildHydratorTool execution should short-circuit with soft error if executeFind does not natively exist on piece or lookup fails', async () => {
    const mockTools: Record<string, any> = {};
    const mockPiece = {
      describeRelatedObjects: vi.fn(),
      // MISSING executeFind natively
    };
    const mockConn = { appName: 'salesforce', displayName: 'SFDC', id: 'sf-1' };

    const metaSpy = vi
      .spyOn((service as any).metadataService, 'describeObjects')
      .mockResolvedValue([{ name: 'Load', label: 'Load' }]);
    const relSpy = vi
      .spyOn((service as any).metadataService, 'describeRelatedObjects')
      .mockResolvedValue([]);

    (service as any).buildHydratorTool(
      mockTools,
      mockPiece,
      mockConn,
      {},
      'trace-id',
      'tenant-1',
    );

    const tool = mockTools['salesforce_sf-1_getEntityWithRelations'];
    // Let's run the native execute block
    const result = await tool.execute({
      objectType: 'Load',
      filters: { id: '1' },
    });

    expect(result.error).toContain('executeFind is not implemented natively');
  });
});
