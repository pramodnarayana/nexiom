import { Test, TestingModule } from '@nestjs/testing';
import { MappingsService } from './mappings.service.js';
import { PinoLogger } from 'nestjs-pino';
import { DB_MANAGER } from '@nexiom/dbmanager';
import { CreateMapping, UpdateMapping } from './mappings.validation.js';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { vi } from 'vitest';

describe('MappingsService', () => {
  let service: MappingsService;

  const mockDb = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    orderBy: vi.fn(),
  };

  const mockLogger = {
    setContext: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MappingsService,
        { provide: PinoLogger, useValue: mockLogger },
        {
          provide: DB_MANAGER,
          useValue: { getTenantDb: vi.fn().mockResolvedValue(mockDb) },
        },
      ],
    }).compile();

    service = module.get<MappingsService>(MappingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should query the database for all records ordered by creation', async () => {
      const dbSelectSpy = vi.fn().mockReturnThis();
      const dbFromSpy = vi.fn().mockReturnThis();
      const dbOrderBySpy = vi.fn().mockResolvedValue([{ id: '1' }]);
      mockDb.select = dbSelectSpy;
      mockDb.from = dbFromSpy;
      mockDb.orderBy = dbOrderBySpy;

      const result = await service.findAll('tenant1');

      expect(mockDb.select).toHaveBeenCalled();
      expect(result).toEqual([{ id: '1' }]);
    });
  });

  describe('findOne', () => {
    it('should return a mapping if found', async () => {
      mockDb.select = vi.fn().mockReturnThis();
      mockDb.from = vi.fn().mockReturnThis();
      mockDb.where = vi.fn().mockReturnThis();
      mockDb.limit = vi
        .fn()
        .mockResolvedValue([{ id: '1', appName: 'salesforce' }]);

      const result = await service.findOne('tenant1', '1');
      expect(result).toEqual({ id: '1', appName: 'salesforce' });
    });

    it('should throw NotFoundException if no records return', async () => {
      mockDb.select = vi.fn().mockReturnThis();
      mockDb.from = vi.fn().mockReturnThis();
      mockDb.where = vi.fn().mockReturnThis();
      mockDb.limit = vi.fn().mockResolvedValue([]);

      await expect(service.findOne('tenant1', 'invalid')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('should insert and invalidate cache safely', async () => {
      const dto = new CreateMapping();
      dto.appName = 'salesforce';
      dto.category = 'tms';
      dto.entity = 'Load__c';
      dto.viewMode = 'summary';
      dto.mappingConfig = {};

      mockDb.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              id: '123',
              appName: 'salesforce',
              category: 'tms',
              entity: 'Load__c',
              viewMode: 'summary',
              version: 'v1',
            },
          ]),
        }),
      });

      const result = await service.create('tenant1', dto);

      expect(result.id).toBe('123');
    });

    it('should default version to v1 if not provided', async () => {
      const dto = new CreateMapping();
      dto.appName = 'salesforce';
      dto.category = 'tms';
      dto.entity = 'Load__c';
      dto.viewMode = 'summary';
      dto.mappingConfig = {};

      const returningSpy = vi.fn().mockResolvedValue([{ version: 'v1' }]);
      const valuesSpy = vi.fn().mockReturnValue({ returning: returningSpy });
      mockDb.insert = vi.fn().mockReturnValue({ values: valuesSpy });

      const result = await service.create('tenant1', dto);

      expect(valuesSpy).toHaveBeenCalledWith(
        expect.objectContaining({ version: 'v1' }),
      );
      expect(result.version).toBe('v1');
    });

    it('should log and throw BadRequestException on insert error', async () => {
      const dto = new CreateMapping();
      mockDb.insert = vi.fn().mockImplementation(() => {
        throw new Error('DB Error');
      });

      await expect(service.create('tenant1', dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should check existing, update, and invalidate cache', async () => {
      const dto = new UpdateMapping();
      dto.appName = 'testapp';

      // @ts-expect-error test mock
      vi.spyOn(service, 'findOne').mockResolvedValue({ id: '123' });
      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValue([{ appName: 'testapp', version: 'v1' }]),
          }),
        }),
      });

      const result = await service.update('tenant1', '123', dto);
      expect(result.appName).toBe('testapp');
    });

    it('should default version to v1 if not provided on update', async () => {
      const dto = new UpdateMapping();
      // @ts-expect-error test mock
      vi.spyOn(service, 'findOne').mockResolvedValue({ id: '123' });

      const returningSpy = vi.fn().mockResolvedValue([{ version: 'v1' }]);
      const whereSpy = vi.fn().mockReturnValue({ returning: returningSpy });
      const setSpy = vi.fn().mockReturnValue({ where: whereSpy });
      mockDb.update = vi.fn().mockReturnValue({ set: setSpy });

      const result = await service.update('tenant1', '123', dto);

      expect(setSpy).toHaveBeenCalledWith(
        expect.objectContaining({ version: 'v1' }),
      );
      expect(result.version).toBe('v1');
    });

    it('should throw BadRequestException wrapping the internal missing record on update', async () => {
      // @ts-expect-error test mock
      vi.spyOn(service, 'findOne').mockResolvedValue({ id: '123' });
      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi
            .fn()
            .mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
        }),
      });

      await expect(
        service.update('tenant1', '123', new UpdateMapping()),
      ).rejects.toThrow(NotFoundException);
    });

    it('should log and throw BadRequestException on update DB error', async () => {
      const dto = new UpdateMapping();
      mockDb.update = vi.fn().mockImplementation(() => {
        throw new Error('DB Error');
      });

      await expect(service.update('tenant1', '123', dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should find existing, delete, and invalidate cache', async () => {
      // @ts-expect-error test mock
      vi.spyOn(service, 'findOne').mockResolvedValue({
        appName: 'test',
        category: 'tms',
        entity: 'x',
        viewMode: 'y',
        version: 'v1',
      });
      mockDb.delete = vi
        .fn()
        .mockReturnValue({ where: vi.fn().mockResolvedValue(true) });

      const result = await service.remove('tenant1', '123');
      expect(result.success).toBe(true);
      expect(mockDb.delete).toHaveBeenCalled();
    });
  });
});
