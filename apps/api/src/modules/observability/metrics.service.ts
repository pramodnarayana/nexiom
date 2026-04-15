import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface MetricPayload {
  tenantId: string;
  stitchId?: string;
  metricName: string;
  value: number;
  tags?: Record<string, string | number | boolean>;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private readonly endpoint: string | undefined;
  private readonly basicAuth: string | undefined;
  private enabled = false;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('OPENOBSERVE_HOST');
    const org = this.config.get<string>('OPENOBSERVE_ORG', 'default');
    const stream = this.config.get<string>(
      'OPENOBSERVE_METRICS_STREAM',
      'pipeline_metrics',
    );

    // E.g. https://api.openobserve.ai/api/default/pipeline_metrics/_json
    if (host) {
      const candidateEndpoint = `${host.replace(/\/$/, '')}/api/${org}/${stream}/_json`;
      try {
        // Validate URL is well-formed before setting endpoint
        new URL(candidateEndpoint);
        this.endpoint = candidateEndpoint;
      } catch (error) {
        this.logger.error(
          `Invalid OPENOBSERVE_HOST configuration: failed to parse URL "${candidateEndpoint}"`,
          error,
        );
        this.enabled = false;
        return;
      }
    }

    const user = this.config.get<string>('OPENOBSERVE_USER');
    const pass = this.config.get<string>('OPENOBSERVE_PASS');

    if (user && pass) {
      this.basicAuth = Buffer.from(`${user}:${pass}`).toString('base64');
    }

    // Enable metrics only if both endpoint and auth are configured
    if (this.endpoint && this.basicAuth) {
      this.enabled = true;
    }
  }

  /**
   * Forwards custom operational metrics to OpenObserve via HTTP endpoint.
   * If OpenObserve is not configured, silently drops the metric in production
   * or logs it to stdout in development.
   */
  recordMetric({
    tenantId,
    stitchId,
    metricName,
    value,
    tags,
  }: MetricPayload): void {
    // Guard against non-finite numeric values
    if (!Number.isFinite(value)) {
      this.logger.error(
        `Invalid metric value for ${metricName}: ${value} (non-finite). Skipping metric.`,
      );
      return;
    }

    const payload = {
      ...tags,
      timestamp: new Date().toISOString(),
      tenantId,
      stitchId,
      _metric: metricName,
      _value: value,
    };

    if (!this.enabled) {
      if (this.config.get('NODE_ENV') !== 'production') {
        this.logger.debug(`[Metric] ${metricName}=${value}`, payload);
      }
      return;
    }

    // TypeScript guard: this.enabled is only true when endpoint and basicAuth are set
    if (!this.endpoint || !this.basicAuth) {
      return;
    }

    try {
      // Fire-and-forget to avoid blocking the pipeline
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${this.basicAuth}`,
        },
        body: JSON.stringify([payload]),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            let responseBody = '';
            try {
              responseBody = await response.text();
            } catch (_parseErr) {
              responseBody = '(unable to read response body)';
            }
            this.logger.error(
              `OpenObserve Metric Delivery Failed for ${metricName}: HTTP ${response.status} ${response.statusText}`,
              responseBody,
            );
          }
        })
        .catch((err) => {
          this.logger.error(
            `OpenObserve Metric Delivery Failed for ${metricName}`,
            err,
          );
        })
        .finally(() => {
          clearTimeout(timeoutId);
        });
    } catch (error) {
      this.logger.error(
        `OpenObserve Metric Delivery Initialization Failed`,
        error,
      );
    }
  }
}
