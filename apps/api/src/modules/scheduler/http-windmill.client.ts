import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WindmillClient,
  schedulePathFor,
  STITCH_RUNNER_PATH,
} from './windmill.client.js';

/** Timeout for all Windmill API calls. Prevents indefinite hangs on network issues. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Deno TypeScript stitch-runner script deployed to Windmill workers. */
const STITCH_RUNNER_CONTENT = `
import * as wmill from "npm:windmill-client@1";

export async function main(stitchId: string): Promise<object> {
  const apiUrl = await wmill.getVariable("f/config/NEXIOM_API_URL");
  const secret = await wmill.getVariable("f/config/WINDMILL_INTERNAL_SECRET");

  const response = await fetch(\`\${apiUrl}/internal/scheduler/execute-stitch\`, {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${secret}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ stitchId }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(\`Stitch execution failed [\${response.status}]: \${body}\`);
  }

  return await response.json();
}
`.trim();

@Injectable()
export class HttpWindmillClient extends WindmillClient {
  private readonly logger = new Logger(HttpWindmillClient.name);
  private readonly baseUrl: string;
  private readonly workspace: string;
  private readonly token: string;

  constructor(private readonly config: ConfigService) {
    super();
    this.baseUrl = this.config.getOrThrow<string>('WINDMILL_BASE_URL');
    this.workspace = this.config.getOrThrow<string>('WINDMILL_WORKSPACE');
    this.token = this.config.getOrThrow<string>('WINDMILL_TOKEN');
  }

  async ensureStitchScript(): Promise<void> {
    const exists = await this.scriptExists(STITCH_RUNNER_PATH);
    if (exists) {
      this.logger.debug(
        `Stitch-runner script already exists at ${STITCH_RUNNER_PATH}`,
      );
      return;
    }

    this.logger.debug(`Creating stitch-runner script at ${STITCH_RUNNER_PATH}`);
    await this.requestVoid('POST', `/scripts/create`, {
      path: STITCH_RUNNER_PATH,
      summary: 'Stitch Runner',
      description:
        'Shared Windmill script that triggers a Nexiom stitch sync via the internal scheduler API.',
      content: STITCH_RUNNER_CONTENT,
      language: 'deno',
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          stitchId: {
            type: 'string',
            description: 'The UUID of the stitch to execute.',
          },
        },
        required: ['stitchId'],
      },
    });
  }

  async createSchedule(
    stitchId: string,
    cron: string,
    enabled: boolean,
  ): Promise<void> {
    await this.requestVoid('POST', '/schedules/create', {
      path: schedulePathFor(stitchId),
      schedule: cron,
      timezone: 'UTC',
      script_path: STITCH_RUNNER_PATH,
      is_flow: false,
      args: { stitchId },
      enabled,
    });
  }

  /**
   * Attempts to update the schedule. Returns false if the schedule does not
   * exist (Windmill 404) so the caller can fall back to createSchedule.
   * Throws on any other non-OK response.
   */
  async updateSchedule(
    stitchId: string,
    cron: string,
    enabled: boolean,
  ): Promise<boolean> {
    const path = schedulePathFor(stitchId);
    const res = await this.rawRequest('POST', `/schedules/update/${path}`, {
      schedule: cron,
      timezone: 'UTC',
      script_path: STITCH_RUNNER_PATH,
      is_flow: false,
      args: { stitchId },
      enabled,
    });

    if (res.status === 404) {
      await res.body?.cancel();
      return false;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Windmill API POST /schedules/update/${path} failed [${res.status}]: ${text}`,
      );
    }
    await res.body?.cancel();
    return true;
  }

  async setScheduleEnabled(stitchId: string, enabled: boolean): Promise<void> {
    const path = schedulePathFor(stitchId);
    await this.requestVoid('POST', `/schedules/setenabled/${path}`, {
      enabled,
    });
    this.logger.debug(`Set schedule enabled=${enabled} for stitch ${stitchId}`);
  }

  async scheduleExists(stitchId: string): Promise<boolean> {
    const path = schedulePathFor(stitchId);
    const res = await this.rawRequest('GET', `/schedules/get/${path}`);
    await res.body?.cancel();
    return res.ok;
  }

  async deleteSchedule(stitchId: string): Promise<void> {
    const path = schedulePathFor(stitchId);
    const res = await this.rawRequest('DELETE', `/schedules/delete/${path}`);
    if (!res.ok && res.status !== 404) {
      const body = await res.text();
      throw new Error(
        `Windmill deleteSchedule failed [${res.status}]: ${body}`,
      );
    }
    await res.body?.cancel();
  }

  async triggerOnce(stitchId: string): Promise<string> {
    // Windmill POST /jobs/run/p/{path} returns the new job UUID as plain text.
    const res = await this.rawRequest(
      'POST',
      `/jobs/run/p/${STITCH_RUNNER_PATH}`,
      { stitchId },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Windmill triggerOnce failed [${res.status}]: ${text}`);
    }
    const jobId = (await res.text()).trim();
    if (!jobId) {
      throw new Error('Windmill triggerOnce returned an empty job ID');
    }
    return jobId;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async scriptExists(scriptPath: string): Promise<boolean> {
    const res = await this.rawRequest('GET', `/scripts/get/p/${scriptPath}`);
    await res.body?.cancel();
    return res.ok;
  }

  private url(path: string): string {
    return `${this.baseUrl}/api/w/${this.workspace}${path}`;
  }

  /**
   * Issues an authenticated HTTP request and returns the raw Response.
   * All calls include a timeout to prevent indefinite hangs.
   * The caller is responsible for draining or cancelling the response body.
   */
  private async rawRequest(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    return fetch(this.url(path), {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  }

  /**
   * Sends a request and asserts a successful response with no meaningful body.
   * Throws a descriptive Error on any non-OK status.
   */
  private async requestVoid(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<void> {
    const res = await this.rawRequest(method, path, body);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Windmill API ${method} ${path} failed [${res.status}]: ${text}`,
      );
    }
    await res.body?.cancel();
  }

  /**
   * Sends a request and parses the response body as JSON.
   * Throws a descriptive Error on non-OK status or an empty body.
   */
  private async requestJson<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await this.rawRequest(method, path, body);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Windmill API ${method} ${path} failed [${res.status}]: ${text}`,
      );
    }
    const text = await res.text();
    if (!text) {
      throw new Error(
        `Windmill API ${method} ${path} returned an empty body where JSON was expected`,
      );
    }
    return JSON.parse(text) as T;
  }
}
