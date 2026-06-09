import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspacePiecesController } from './workspace-pieces.controller.js';
import type { IQueueService } from '@soopa/queue';
import type { DrizzleDb } from '@soopa/database';
import { NotFoundException } from '@nestjs/common';
import { QueueName } from '@soopa/queue';

describe('WorkspacePiecesController', () => {
  let controller: WorkspacePiecesController;
  let queueServiceMock: { send: ReturnType<typeof vi.fn> };
  let dbMock: {
    select: ReturnType<typeof vi.fn>;
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    values: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    returning: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    queueServiceMock = {
      send: vi.fn(),
    };

    dbMock = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'wp-mock-id' }]),
    };

    controller = new WorkspacePiecesController(
      queueServiceMock as unknown as IQueueService,
      dbMock as unknown as DrizzleDb,
    );
  });

  it('throws NotFoundException if the piece does not exist in the global registry', async () => {
    // Mock the global registry check to return empty
    dbMock.where.mockResolvedValueOnce([]);

    await expect(
      controller.installPiece('ws-123', 'invalid-piece-id'),
    ).rejects.toThrow(NotFoundException);
  });

  it('inserts an INSTALLING record and dispatches to queue if piece exists', async () => {
    // 1st query: Global registry check
    dbMock.where.mockResolvedValueOnce([
      {
        id: 'piece-123',
        packageName: '@soopa/piece-salesforce',
        version: '1.0.0',
      },
    ]);

    // 2nd query: Workspace piece check (returns empty meaning not installed)
    dbMock.where.mockResolvedValueOnce([]);

    const result = await controller.installPiece('ws-123', 'piece-123');

    expect(result).toEqual({
      status: 'accepted',
      message: 'Installation queued',
    });

    // Verify insert
    expect(dbMock.insert).toHaveBeenCalled();
    expect(dbMock.values).toHaveBeenCalledWith({
      workspaceId: 'ws-123',
      pieceId: 'piece-123',
      status: 'INSTALLING',
    });

    // Verify queue dispatch
    expect(queueServiceMock.send).toHaveBeenCalledWith(
      QueueName.PluginInstallQueue,
      expect.objectContaining({
        packageName: '@soopa/piece-salesforce',
        version: '1.0.0',
        workspaceId: 'ws-123',
        pieceId: 'piece-123',
      }),
    );
  });

  it('updates the existing record to INSTALLING if it already exists', async () => {
    // 1st query: Global registry check
    dbMock.where.mockResolvedValueOnce([
      {
        id: 'piece-123',
        packageName: '@soopa/piece-salesforce',
        version: '1.0.0',
      },
    ]);

    // 2nd query: Workspace piece check (returns existing record)
    dbMock.where.mockResolvedValueOnce([
      {
        id: 'wp-123',
        workspaceId: 'ws-123',
        pieceId: 'piece-123',
        status: 'FAILED',
      },
    ]);

    await controller.installPiece('ws-123', 'piece-123', '1.1.0');

    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(dbMock.update).toHaveBeenCalled();
    expect(dbMock.set).toHaveBeenCalledWith({ status: 'INSTALLING' });

    // Verify queue dispatch uses the requested version override
    expect(queueServiceMock.send).toHaveBeenCalledWith(
      QueueName.PluginInstallQueue,
      expect.objectContaining({
        version: '1.1.0',
      }),
    );
  });
});
