import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from './metrics.service.js';
import { vi, type Mocked, type Mock } from 'vitest';

describe('MetricsService', () => {
  let service: MetricsService;
  let configService: Mocked<ConfigService>;

  beforeEach(async () => {
    configService = {
      get: vi.fn(),
    } as unknown as Mocked<ConfigService>;

    configService.get.mockImplementation(
      (key: string, defaultValue?: string) => {
        switch (key) {
          case 'OPENOBSERVE_HOST':
            return 'https://api.openobserve.ai';
          case 'OPENOBSERVE_ORG':
            return 'default';
          case 'OPENOBSERVE_METRICS_STREAM':
            return 'pipeline_metrics';
          case 'OPENOBSERVE_USER':
            return 'user';
          case 'OPENOBSERVE_PASS':
            return 'pass';
          case 'NODE_ENV':
            return 'test';
          default:
            return defaultValue;
        }
      },
    );

    // Mock global fetch
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should format and post payload to openobserve', () => {
    service.recordMetric({
      tenantId: 'test-tenant',
      stitchId: 'test-stitch',
      metricName: 'bytes_synced',
      value: 1024,
      tags: { source: 'salesforce' },
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);

    const callArgs = (global.fetch as Mock).mock.calls[0];
    const url = callArgs[0] as string;
    const reqInit = callArgs[1] as Record<string, unknown>;

    expect(url).toEqual(
      'https://api.openobserve.ai/api/default/pipeline_metrics/_json',
    );
    expect(reqInit).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic dXNlcjpwYXNz', // base64 of user:pass
      },
    });

    expect(typeof reqInit.body).toBe('string');
    expect(reqInit.body as string).toContain('"_metric":"bytes_synced"');
  });

  it('should handle fetch errors gracefully', () => {
    (global.fetch as Mock).mockRejectedValueOnce(new Error('Network Error'));

    expect(() =>
      service.recordMetric({
        tenantId: 'test-tenant',
        metricName: 'bytes_synced',
        value: 1024,
      }),
    ).not.toThrow();
  });

  it('should drop gracefully when no auth configured', async () => {
    // Override the mocked basic auth
    configService.get.mockImplementation(
      (key: string, defaultValue?: string) => {
        if (key === 'OPENOBSERVE_USER') return undefined; // No user
        if (key === 'NODE_ENV') return 'development';
        return defaultValue;
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    const noAuthService = module.get<MetricsService>(MetricsService);

    noAuthService.recordMetric({
      tenantId: 'test-tenant',
      metricName: 'bytes_synced',
      value: 1024,
    });

    // Config lacked user, meaning no API endpoint fired
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
