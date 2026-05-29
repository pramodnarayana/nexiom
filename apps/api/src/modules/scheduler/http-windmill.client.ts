import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WindmillClient,
  schedulePathFor,
  CONNECTION_RUNNER_PATH,
} from './windmill.client.js';

/** Timeout for all Windmill API calls. Prevents indefinite hangs on network issues. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Deno TypeScript connection-runner script deployed to Windmill workers. */
const CONNECTION_RUNNER_CONTENT = (apiUrl: string, secret: string) =>
  `
import * as wmill from "npm:windmill-client@1";

export async function main(dataSourceId: string): Promise<object> {
  const response = await fetch(${JSON.stringify(apiUrl + '/api/internal/scheduler/execute-connection')}, {
    method: "POST",
    headers: {
      "Authorization": ${JSON.stringify('Bearer ' + secret)},
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ dataSourceId }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(\`Connection sync execution failed [\${response.status}]: \${body}\`);
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
  private readonly internalSecret: string;
  private readonly callbackUrl: string;

  constructor(private readonly config: ConfigService) {
    super();
    this.baseUrl = this.config.getOrThrow<string>('WINDMILL_BASE_URL');
    this.workspace = this.config.getOrThrow<string>('WINDMILL_WORKSPACE');
    this.token = this.config.getOrThrow<string>('WINDMILL_TOKEN');
    this.internalSecret = this.config.getOrThrow<string>(
      'WINDMILL_INTERNAL_SECRET',
    );
    this.callbackUrl = this.config.get<string>(
      'WINDMILL_CALLBACK_URL',
      'http://host.docker.internal:3000',
    );
  }

  async ensureConnectionScript(): Promise<void> {
    const res = await this.rawRequest('POST', `/scripts/create`, {
      path: CONNECTION_RUNNER_PATH,
      summary: 'Connection Runner',
      description:
        'Shared Windmill script that triggers a Nexiom connection sync via the internal scheduler API.',
      content: CONNECTION_RUNNER_CONTENT(this.callbackUrl, this.internalSecret),
      language: 'deno',
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          dataSourceId: {
            type: 'string',
            description: 'The UUID of the connection/data source to execute.',
          },
        },
        required: ['dataSourceId'],
      },
    });

    if (res.ok) {
      await res.body?.cancel();
      this.logger.debug(
        `Deployed connection-runner script at ${CONNECTION_RUNNER_PATH}`,
      );
      return;
    }
    if (res.status === 409) {
      // Windmill returns 409 when an identical content hash already exists at this
      // path (truly idempotent).  If CONNECTION_RUNNER_CONTENT changed since the last
      // deploy, the hash differs and Windmill creates a new version (200).
      // A persistent 409 after a content change indicates the Windmill workspace
      // needs a manual redeploy (delete the script at the path and redeploy).
      // Read a bounded snippet (≤1 KB) for diagnostics — discard the rest.
      let snippet = '';
      try {
        const full = await res.text();
        snippet = full.length > 1024 ? `${full.slice(0, 1024)}…` : full;
      } catch {
        // Ignore body-read errors — the 409 itself is sufficient signal.
      }
      this.logger.warn(
        `Connection-runner script at ${CONNECTION_RUNNER_PATH} returned 409 — ` +
          `script content matches an existing version or a manual redeploy is needed` +
          (snippet ? `. Response: ${snippet}` : '.'),
      );
      return;
    }
    const body = await res.text();
    throw new Error(
      `Windmill API POST /scripts/create failed [${res.status}]: ${body}`,
    );
  }

  async createSchedule(
    connectionId: string,
    cron: string,
    enabled: boolean,
  ): Promise<void> {
    await this.requestVoid('POST', '/schedules/create', {
      path: schedulePathFor(connectionId),
      schedule: cron,
      timezone: 'UTC',
      script_path: CONNECTION_RUNNER_PATH,
      is_flow: false,
      args: { dataSourceId: connectionId },
      enabled,
    });
  }

  /**
   * Attempts to update the schedule. Returns false if the schedule does not
   * exist (Windmill 404) so the caller can fall back to createSchedule.
   * Throws on any other non-OK response.
   */
  async updateSchedule(
    connectionId: string,
    cron: string,
    enabled: boolean,
  ): Promise<boolean> {
    const path = schedulePathFor(connectionId);
    const res = await this.rawRequest('POST', `/schedules/update/${path}`, {
      schedule: cron,
      timezone: 'UTC',
      script_path: CONNECTION_RUNNER_PATH,
      is_flow: false,
      args: { dataSourceId: connectionId },
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

  async setScheduleEnabled(
    connectionId: string,
    enabled: boolean,
  ): Promise<void> {
    const path = schedulePathFor(connectionId);
    await this.requestVoid('POST', `/schedules/setenabled/${path}`, {
      enabled,
    });
    this.logger.debug(
      `Set schedule enabled=${enabled} for connection ${connectionId}`,
    );
  }

  async scheduleExists(connectionId: string): Promise<boolean> {
    const path = schedulePathFor(connectionId);
    const res = await this.rawRequest('GET', `/schedules/get/${path}`);
    return this.existsOrThrow(res);
  }

  async deleteSchedule(connectionId: string): Promise<void> {
    const path = schedulePathFor(connectionId);
    const res = await this.rawRequest('DELETE', `/schedules/delete/${path}`);
    if (!res.ok && res.status !== 404) {
      const body = await res.text();
      throw new Error(
        `Windmill deleteSchedule failed [${res.status}]: ${body}`,
      );
    }
    await res.body?.cancel();
  }

  async triggerOnce(connectionId: string): Promise<string> {
    // Windmill POST /jobs/run/p/{path} returns the new job UUID as plain text.
    const res = await this.rawRequest(
      'POST',
      `/jobs/run/p/${CONNECTION_RUNNER_PATH}`,
      { dataSourceId: connectionId },
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

  private async existsOrThrow(res: Response): Promise<boolean> {
    if (res.ok) {
      await res.body?.cancel();
      return true;
    }
    if (res.status === 404) {
      await res.body?.cancel();
      return false;
    }
    const body = await res.text();
    throw new Error(
      `Windmill API returned unexpected status [${res.status}]: ${body}`,
    );
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
        // Only set Content-Type when there is a body — some API gateways reject
        // GET requests that carry a Content-Type header.
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
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
}
