export interface LogContext {
    app?: string;
    object?: string;
    [key: string]: string | undefined;
}

/**
 * Structured JSON logger for the Intelligent Generic Trigger engine.
 * Each log line is a single JSON object, readable by log aggregators
 * (Datadog, CloudWatch, GCP Logging, etc.) without additional parsing.
 *
 * Usage:
 *   const log = new IgtLogger({ app: 'salesforce', object: 'Contact' });
 *   log.info('Poll complete', { records: 42, cursorField: 'SystemModstamp' });
 */
export class IgtLogger {
    constructor(private readonly ctx: LogContext = {}) {}

    /** Returns a new logger with additional context merged in. */
    withContext(extra: LogContext): IgtLogger {
        return new IgtLogger({ ...this.ctx, ...extra });
    }

    info(msg: string, data?: Record<string, unknown>): void {
        this.emit('INFO', msg, data);
    }

    warn(msg: string, data?: Record<string, unknown>): void {
        this.emit('WARN', msg, data);
    }

    error(msg: string, data?: Record<string, unknown>): void {
        this.emit('ERROR', msg, data);
    }

    debug(msg: string, data?: Record<string, unknown>): void {
        this.emit('DEBUG', msg, data);
    }

    private emit(level: string, msg: string, data?: Record<string, unknown>): void {
        const entry = JSON.stringify({
            level,
            ts: new Date().toISOString(),
            component: 'igt',
            ...this.ctx,
            msg,
            ...data,
        });

        if (level === 'ERROR') console.error(entry);
        else if (level === 'WARN') console.warn(entry);
        else if (level === 'DEBUG') console.debug(entry);
        else console.log(entry);
    }
}
