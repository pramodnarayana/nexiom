import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { WindmillSchedulerClient } from './windmill-scheduler.client.js';
import { IHttpClient } from '../interfaces/http-client.interface.js';

const BASE_URL = 'https://windmill.example.com';
const WORKSPACE = 'nexiom';
const TOKEN = 'test-token';
const STITCH_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function mockConfig(): ConfigService {
  return {
    get: <T = unknown>(_key: string, defaultValue: T): T => defaultValue,
    getOrThrow: (key: string) => {
      const map: Record<string, string> = {
        WINDMILL_BASE_URL: BASE_URL,
        WINDMILL_WORKSPACE: WORKSPACE,
        WINDMILL_TOKEN: TOKEN,
        WINDMILL_INTERNAL_SECRET: 'test-internal-secret',
      };
      if (!(key in map)) throw new Error(`Missing config key: ${key}`);
      return map[key];
    },
  } as unknown as ConfigService;
}

function mockResponse(status: number, body = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(body),
    body: {
      cancel: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Response;
}

function getCallUrl(spy: ReturnType<typeof vi.fn>, index: number): string {
  return spy.mock.calls[index][1] as string;
}

function getCallOptions(
  spy: ReturnType<typeof vi.fn>,
  index: number,
): Record<string, unknown> {
  return spy.mock.calls[index][2] as Record<string, unknown>;
}

describe('WindmillSchedulerClient', () => {
  let client: WindmillSchedulerClient;
  let requestSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    requestSpy = vi.fn();
    const mockHttpClient = {
      request: requestSpy,
    };

    const module = await Test.createTestingModule({
      providers: [
        WindmillSchedulerClient,
        { provide: ConfigService, useValue: mockConfig() },
        { provide: IHttpClient, useValue: mockHttpClient },
      ],
    }).compile();

    client = module.get(WindmillSchedulerClient);
  });

  // ── ensureConnectionScript ──────────────────────────────────────────────────

  describe('ensureConnectionScript', () => {
    it('deploys the script when Windmill responds 200', async () => {
      requestSpy.mockResolvedValue(mockResponse(200, ''));
      await expect(client.ensureConnectionScript()).resolves.toBeUndefined();
      expect(requestSpy).toHaveBeenCalledTimes(1);
      expect(requestSpy.mock.calls[0][0]).toBe('POST'); // Method
    });

    it('treats 409 as non-fatal — same content hash already deployed', async () => {
      requestSpy.mockResolvedValue(mockResponse(409, 'conflict'));
      await expect(client.ensureConnectionScript()).resolves.toBeUndefined();
    });

    it('throws for non-409 errors', async () => {
      requestSpy.mockResolvedValue(mockResponse(500, 'server error'));
      await expect(client.ensureConnectionScript()).rejects.toThrow('500');
    });
  });

  // ── createSchedule ──────────────────────────────────────────────────────

  describe('createSchedule', () => {
    it('posts to /schedules/create and resolves', async () => {
      requestSpy.mockResolvedValue(mockResponse(200, ''));

      await expect(
        client.createSchedule(STITCH_ID, '0 0/30 * * * *', true),
      ).resolves.toBeUndefined();

      expect(requestSpy).toHaveBeenCalledTimes(1);
      const url = getCallUrl(requestSpy, 0);
      const options = getCallOptions(requestSpy, 0);
      expect(url).toContain('/schedules/create');
      expect(requestSpy.mock.calls[0][0]).toBe('POST');
      const body = JSON.parse(options.body as string) as Record<
        string,
        unknown
      >;
      expect(body.enabled).toBe(true);
      expect(body.args).toEqual({ dataSourceId: STITCH_ID });
    });

    it('throws on non-OK response', async () => {
      requestSpy.mockResolvedValue(mockResponse(409, 'conflict'));
      await expect(
        client.createSchedule(STITCH_ID, '0 0 * * * *', true),
      ).rejects.toThrow('409');
    });
  });

  // ── updateSchedule ──────────────────────────────────────────────────────

  describe('updateSchedule', () => {
    it('returns true when Windmill updates successfully', async () => {
      requestSpy.mockResolvedValue(mockResponse(200, ''));

      const result = await client.updateSchedule(
        STITCH_ID,
        '0 0 * * * *',
        false,
      );

      expect(result).toBe(true);
    });

    it('returns false when Windmill responds with 404 (schedule not found)', async () => {
      requestSpy.mockResolvedValue(mockResponse(404, 'not found'));

      const result = await client.updateSchedule(
        STITCH_ID,
        '0 0 * * * *',
        true,
      );

      expect(result).toBe(false);
    });

    it('throws on other non-OK responses', async () => {
      requestSpy.mockResolvedValue(mockResponse(500, 'server error'));
      await expect(
        client.updateSchedule(STITCH_ID, '0 0 * * * *', true),
      ).rejects.toThrow('500');
    });
  });

  // ── setScheduleEnabled ──────────────────────────────────────────────────

  describe('setScheduleEnabled', () => {
    it('posts to /schedules/setenabled and resolves', async () => {
      requestSpy.mockResolvedValue(mockResponse(200, ''));

      await expect(
        client.setScheduleEnabled(STITCH_ID, false),
      ).resolves.toBeUndefined();

      const url = getCallUrl(requestSpy, 0);
      const options = getCallOptions(requestSpy, 0);
      expect(url).toContain('setenabled');
      expect(JSON.parse(options.body as string)).toEqual({ enabled: false });
    });
  });

  // ── scheduleExists ──────────────────────────────────────────────────────

  describe('scheduleExists', () => {
    it('returns true when Windmill returns 200', async () => {
      requestSpy.mockResolvedValue(mockResponse(200, '{}'));
      expect(await client.scheduleExists(STITCH_ID)).toBe(true);
    });

    it('returns false when Windmill returns 404', async () => {
      requestSpy.mockResolvedValue(mockResponse(404, ''));
      expect(await client.scheduleExists(STITCH_ID)).toBe(false);
    });

    it('throws for non-404 errors (e.g. 500)', async () => {
      requestSpy.mockResolvedValue(mockResponse(500, 'server error'));
      await expect(client.scheduleExists(STITCH_ID)).rejects.toThrow('500');
    });
  });

  // ── deleteSchedule ──────────────────────────────────────────────────────

  describe('deleteSchedule', () => {
    it('resolves when deletion succeeds', async () => {
      requestSpy.mockResolvedValue(mockResponse(200, ''));
      await expect(client.deleteSchedule(STITCH_ID)).resolves.toBeUndefined();
    });

    it('is a no-op when Windmill returns 404 (already deleted)', async () => {
      requestSpy.mockResolvedValue(mockResponse(404, ''));
      await expect(client.deleteSchedule(STITCH_ID)).resolves.toBeUndefined();
    });

    it('throws when Windmill returns a non-404 error', async () => {
      requestSpy.mockResolvedValue(mockResponse(500, 'internal error'));
      await expect(client.deleteSchedule(STITCH_ID)).rejects.toThrow('500');
    });
  });

  // ── triggerOnce ─────────────────────────────────────────────────────────

  describe('triggerOnce', () => {
    it('returns the job ID from Windmill', async () => {
      requestSpy.mockResolvedValue(mockResponse(200, 'job-uuid-123\n'));
      const jobId = await client.triggerOnce(STITCH_ID);
      expect(jobId).toBe('job-uuid-123');
    });

    it('throws when Windmill returns a non-OK status', async () => {
      requestSpy.mockResolvedValue(mockResponse(400, 'bad request'));
      await expect(client.triggerOnce(STITCH_ID)).rejects.toThrow('400');
    });

    it('throws when Windmill returns an empty job ID', async () => {
      requestSpy.mockResolvedValue(mockResponse(200, '   '));
      await expect(client.triggerOnce(STITCH_ID)).rejects.toThrow(
        'empty job ID',
      );
    });
  });

  // ── auth / request headers ───────────────────────────────────────────────

  describe('authorization headers', () => {
    it('sends the Bearer token on every request', async () => {
      requestSpy.mockResolvedValue(mockResponse(200, ''));
      await client.scheduleExists(STITCH_ID);

      const options = getCallOptions(requestSpy, 0) as {
        headers: Record<string, string>;
      };
      expect(options.headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    });

    it('includes timeoutMs on every request', async () => {
      requestSpy.mockResolvedValue(mockResponse(200, ''));
      await client.scheduleExists(STITCH_ID);

      const options = getCallOptions(requestSpy, 0) as { timeoutMs: number };
      expect(options.timeoutMs).toBe(10_000);
    });

    it('omits Content-Type on GET requests (no body)', async () => {
      requestSpy.mockResolvedValue(mockResponse(200, '{}'));
      await client.scheduleExists(STITCH_ID);

      const options = getCallOptions(requestSpy, 0) as {
        headers: Record<string, string>;
      };
      expect(options.headers['Content-Type']).toBeUndefined();
    });

    it('includes Content-Type: application/json on POST requests with a body', async () => {
      requestSpy.mockResolvedValue(mockResponse(200, ''));
      await client.setScheduleEnabled(STITCH_ID, true);

      const options = getCallOptions(requestSpy, 0) as {
        headers: Record<string, string>;
      };
      expect(options.headers['Content-Type']).toBe('application/json');
    });
  });
});
