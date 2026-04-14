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

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('OPENOBSERVE_HOST');
    const org = this.config.get<string>('OPENOBSERVE_ORG', 'default');
    const stream = this.config.get<string>(
      'OPENOBSERVE_METRICS_STREAM',
      'pipeline_metrics',
    );

    // E.g. https://api.openobserve.ai/api/default/pipeline_metrics/_json
    if (host) {
      this.endpoint = `${host.replace(/\/$/, '')}/api/${org}/${stream}/_json`;
    }

    const user = this.config.get<string>('OPENOBSERVE_USER');
    const pass = this.config.get<string>('OPENOBSERVE_PASS');

    if (user && pass) {
      this.basicAuth = Buffer.from(`${user}:${pass}`).toString('base64');
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
    const payload = {
      ...tags,
      timestamp: new Date().toISOString(),
      tenantId,
      stitchId,
      _metric: metricName,
      _value: value,
    };

    if (!this.endpoint || !this.basicAuth) {
      if (this.config.get('NODE_ENV') !== 'production') {
        this.logger.debug(`[Metric] ${metricName}=${value}`, payload);
      }
      return;
    }

    try {
      // Fire-and-forget to avoid blocking the pipeline
      fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${this.basicAuth}`,
        },
        body: JSON.stringify([payload]),
      }).catch((err) => {
        this.logger.error(
          `OpenObserve Metric Delivery Failed for ${metricName}`,
          err,
        );
      });
    } catch (error) {
      this.logger.error(
        `OpenObserve Metric Delivery Initialization Failed`,
        error,
      );
    }
  }
}