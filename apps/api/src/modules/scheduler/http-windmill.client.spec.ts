import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { HttpWindmillClient } from './http-windmill.client.js';

const BASE_URL = 'https://windmill.example.com';
const WORKSPACE = 'nexiom';
const TOKEN = 'test-token';
const STITCH_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function mockConfig(): ConfigService {
  return {
    getOrThrow: (key: string) => {
      const map: Record<string, string> = {
        WINDMILL_BASE_URL: BASE_URL,
        WINDMILL_WORKSPACE: WORKSPACE,
        WINDMILL_TOKEN: TOKEN,
      };
      if (!(key in map)) throw new Error(`Missing config key: ${key}`);
      return map[key];
    },
  } as unknown as ConfigService;
}

/** Build a mock Response. body.cancel() is a no-op. */
function mockResponse(status: number, body = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(body),
    body: { cancel: vi.fn().mockResolvedValue(undefined) },
  } as unknown as Response;
}

/** Type-safe accessor for the URL argument of a mocked fetch call. */
function getCallUrl(spy: ReturnType<typeof vi.fn>, index: number): string {
  return spy.mock.calls[index][0] as string;
}

/** Type-safe accessor for the RequestInit argument of a mocked fetch call. */
function getCallInit(
  spy: ReturnType<typeof vi.fn>,
  index: number,
): RequestInit {
  return spy.mock.calls[index][1] as RequestInit;
}

describe('HttpWindmillClient', () => {
  let client: HttpWindmillClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const module = await Test.createTestingModule({
      providers: [
        HttpWindmillClient,
        { provide: ConfigService, useValue: mockConfig() },
      ],
    }).compile();

    client = module.get(HttpWindmillClient);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── ensureStitchScript ──────────────────────────────────────────────────

  describe('ensureStitchScript', () => {
    it('deploys the script when Windmill responds 200', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, ''));
      await expect(client.ensureStitchScript()).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(getCallInit(fetchSpy, 0).method).toBe('POST');
    });

    it('treats 409 Conflict as success (idempotent — script already exists)', async () => {
      fetchSpy.mockResolvedValue(mockResponse(409, 'conflict'));
      await expect(client.ensureStitchScript()).resolves.toBeUndefined();
    });

    it('throws for non-409 errors', async () => {
      fetchSpy.mockResolvedValue(mockResponse(500, 'server error'));
      await expect(client.ensureStitchScript()).rejects.toThrow('500');
    });
  });

  // ── createSchedule ──────────────────────────────────────────────────────

  describe('createSchedule', () => {
    it('posts to /schedules/create and resolves', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, ''));

      await expect(
        client.createSchedule(STITCH_ID, '0 0/30 * * * *', true),
      ).resolves.toBeUndefined();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const url = getCallUrl(fetchSpy, 0);
      const init = getCallInit(fetchSpy, 0);
      expect(url).toContain('/schedules/create');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string) as {
        enabled: boolean;
        args: { stitchId: string };
      };
      expect(body.enabled).toBe(true);
      expect(body.args).toEqual({ stitchId: STITCH_ID });
    });

    it('throws on non-OK response', async () => {
      fetchSpy.mockResolvedValue(mockResponse(409, 'conflict'));
      await expect(
        client.createSchedule(STITCH_ID, '0 0 * * * *', true),
      ).rejects.toThrow('409');
    });
  });

  // ── updateSchedule ──────────────────────────────────────────────────────

  describe('updateSchedule', () => {
    it('returns true when Windmill updates successfully', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, ''));

      const result = await client.updateSchedule(
        STITCH_ID,
        '0 0 * * * *',
        false,
      );

      expect(result).toBe(true);
    });

    it('returns false when Windmill responds with 404 (schedule not found)', async () => {
      fetchSpy.mockResolvedValue(mockResponse(404, 'not found'));

      const result = await client.updateSchedule(
        STITCH_ID,
        '0 0 * * * *',
        true,
      );

      expect(result).toBe(false);
    });

    it('throws on other non-OK responses', async () => {
      fetchSpy.mockResolvedValue(mockResponse(500, 'server error'));
      await expect(
        client.updateSchedule(STITCH_ID, '0 0 * * * *', true),
      ).rejects.toThrow('500');
    });
  });

  // ── setScheduleEnabled ──────────────────────────────────────────────────

  describe('setScheduleEnabled', () => {
    it('posts to /schedules/setenabled and resolves', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, ''));

      await expect(
        client.setScheduleEnabled(STITCH_ID, false),
      ).resolves.toBeUndefined();

      const url = getCallUrl(fetchSpy, 0);
      const init = getCallInit(fetchSpy, 0);
      expect(url).toContain('setenabled');
      expect(JSON.parse(init.body as string)).toEqual({ enabled: false });
    });
  });

  // ── scheduleExists ──────────────────────────────────────────────────────

  describe('scheduleExists', () => {
    it('returns true when Windmill returns 200', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, '{}'));
      expect(await client.scheduleExists(STITCH_ID)).toBe(true);
    });

    it('returns false when Windmill returns 404', async () => {
      fetchSpy.mockResolvedValue(mockResponse(404, ''));
      expect(await client.scheduleExists(STITCH_ID)).toBe(false);
    });

    it('throws for non-404 errors (e.g. 500)', async () => {
      fetchSpy.mockResolvedValue(mockResponse(500, 'server error'));
      await expect(client.scheduleExists(STITCH_ID)).rejects.toThrow('500');
    });
  });

  // ── deleteSchedule ──────────────────────────────────────────────────────

  describe('deleteSchedule', () => {
    it('resolves when deletion succeeds', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, ''));
      await expect(client.deleteSchedule(STITCH_ID)).resolves.toBeUndefined();
    });

    it('is a no-op when Windmill returns 404 (already deleted)', async () => {
      fetchSpy.mockResolvedValue(mockResponse(404, ''));
      await expect(client.deleteSchedule(STITCH_ID)).resolves.toBeUndefined();
    });

    it('throws when Windmill returns a non-404 error', async () => {
      fetchSpy.mockResolvedValue(mockResponse(500, 'internal error'));
      await expect(client.deleteSchedule(STITCH_ID)).rejects.toThrow('500');
    });
  });

  // ── triggerOnce ─────────────────────────────────────────────────────────

  describe('triggerOnce', () => {
    it('returns the job ID from Windmill', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, 'job-uuid-123\n'));
      const jobId = await client.triggerOnce(STITCH_ID);
      expect(jobId).toBe('job-uuid-123');
    });

    it('throws when Windmill returns a non-OK status', async () => {
      fetchSpy.mockResolvedValue(mockResponse(400, 'bad request'));
      await expect(client.triggerOnce(STITCH_ID)).rejects.toThrow('400');
    });

    it('throws when Windmill returns an empty job ID', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, '   '));
      await expect(client.triggerOnce(STITCH_ID)).rejects.toThrow(
        'empty job ID',
      );
    });
  });

  // ── auth / request headers ───────────────────────────────────────────────

  describe('authorization headers', () => {
    it('sends the Bearer token on every request', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, ''));
      await client.scheduleExists(STITCH_ID);

      const headers = getCallInit(fetchSpy, 0).headers as Record<
        string,
        string
      >;
      expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    });

    it('includes AbortSignal.timeout on every request', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, ''));
      await client.scheduleExists(STITCH_ID);

      const init = getCallInit(fetchSpy, 0);
      expect(init.signal).toBeDefined();
    });
  });
});
