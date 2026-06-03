/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectionExplorerController } from './connection-explorer.controller.js';
import { DataExplorerService } from './data-explorer.service.js';
import { BadRequestException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestAuthContext } from '@soopa/auth';
import { AuthGuard } from '@soopa/auth';

describe('ConnectionExplorerController', () => {
  let controller: ConnectionExplorerController;
  let service: any;

  beforeEach(async () => {
    service = {
      listConnectionInbound: vi.fn(),
      listConnectionReplica: vi.fn(),
      listConnectionNormalized: vi.fn(),
      listConnectionOutbound: vi.fn(),
      listObjectsByConnection: vi.fn(),
      getConnectionTrace: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectionExplorerController],
      providers: [{ provide: DataExplorerService, useValue: service }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ConnectionExplorerController>(
      ConnectionExplorerController,
    );
  });

  const mockCtx = {
    user: { organizationId: 'org_1' },
  } as RequestAuthContext;

  const mockNoOrgCtx = {} as RequestAuthContext;

  it('should throw BadRequestException if org is missing', async () => {
    await expect(
      controller.listByTab(mockNoOrgCtx, 's1', 'inbound', 1, 10),
    ).rejects.toThrow(BadRequestException);
  });

  it('listByTab(inbound) should delegate to service.listConnectionInbound', async () => {
    service.listConnectionInbound.mockResolvedValue('res');
    expect(
      await controller.listByTab(mockCtx, 's1', 'inbound', 1, 10, 'ws1'),
    ).toBe('res');
    expect(service.listConnectionInbound).toHaveBeenCalledWith(
      'org_1',
      's1',
      1,
      10,
      'ws1',
      undefined,
      undefined,
    );
  });

  it('listByTab(replica) should delegate to service.listConnectionReplica', async () => {
    service.listConnectionReplica.mockResolvedValue('res');
    expect(
      await controller.listByTab(mockCtx, 's1', 'replica', 1, 10, 'ws1'),
    ).toBe('res');
    expect(service.listConnectionReplica).toHaveBeenCalledWith(
      'org_1',
      's1',
      1,
      10,
      'ws1',
      undefined,
      undefined,
    );
  });

  it('listByTab(normalized) should delegate to service.listConnectionNormalized', async () => {
    service.listConnectionNormalized.mockResolvedValue('res');
    expect(
      await controller.listByTab(mockCtx, 's1', 'normalized', 1, 10, 'ws1'),
    ).toBe('res');
    expect(service.listConnectionNormalized).toHaveBeenCalledWith(
      'org_1',
      's1',
      1,
      10,
      'ws1',
      undefined,
      undefined,
    );
  });

  it('listByTab(entity-map) should throw BadRequestException', async () => {
    await expect(
      controller.listByTab(mockCtx, 's1', 'entity-map', 1, 10, 'ws1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('listByTab(outbound) should delegate to service.listConnectionOutbound', async () => {
    service.listConnectionOutbound.mockResolvedValue('res');
    expect(
      await controller.listByTab(mockCtx, 's1', 'outbound', 1, 10, 'ws1'),
    ).toBe('res');
    expect(service.listConnectionOutbound).toHaveBeenCalledWith(
      'org_1',
      's1',
      1,
      10,
      'ws1',
    );
  });

  it('listObjectsByConnection should delegate to service.listObjectsByConnection', async () => {
    service.listObjectsByConnection.mockResolvedValue('res');
    expect(
      await controller.listObjectsByConnection(
        mockCtx,
        's1',
        'entity-map',
        'ws1',
      ),
    ).toBe('res');
    expect(service.listObjectsByConnection).toHaveBeenCalledWith(
      'org_1',
      's1',
      'entity-map',
      'ws1',
    );
  });

  it('getConnectionTrace should delegate to service.getConnectionTrace', async () => {
    service.getConnectionTrace = vi.fn().mockResolvedValue('trace');
    expect(await controller.getConnectionTrace(mockCtx, 's1', 't1')).toBe(
      'trace',
    );
    expect(service.getConnectionTrace).toHaveBeenCalledWith(
      'org_1',
      's1',
      't1',
    );
  });
});
