import express from 'express';
import cors from 'cors';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { OpenAPIBackend } from 'openapi-backend';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';

const logger = pino({ name: 'mock-gateway', level: 'debug' });
const app = express();

app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));

const candidatePaths = [
  join(process.cwd(), '../../packages/pieces'),
  join(process.cwd(), 'packages/pieces'),
  join(process.cwd(), '../packages/pieces'),
];

const piecesDir = candidatePaths.find(p => existsSync(p));

async function bootstrap() {
  if (piecesDir) {
    const pieces = readdirSync(piecesDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const piece of pieces) {
      const specPath = join(piecesDir, piece, 'openapi.json');
      if (existsSync(specPath)) {
        const api = new OpenAPIBackend({ definition: specPath });
        
        api.register({
          notFound: (c, req, res) => res.status(404).json({ err: `Mock route ${req.path} not found in ${piece} spec` }),
          notImplemented: async (c, req, res) => {
            try {
              // Generate mock dynamically from OpenAPI components/schema examples
              const operationId = (c.operation.operationId as string | undefined) ?? c.operation.path;
              const { status, mock } = await c.api.mockResponseForOperation(operationId) as { status: number, mock: any };
              return res.status(status).json(mock);
            } catch (e: unknown) {
              logger.warn({ err: e }, `Failed to generate strict OpenAPI mock for ${piece} ${req.path}`);
              return res.status(200).json({ id: 'dummy-success', status: 'mocked' });
            }
          },
          validationFail: (c, req, res) => res.status(400).json({ err: c.validation.errors }),
        });
        
        await api.init();
        
        logger.info(`Mounted mock proxy for ${piece} at /mock/${piece}`);
        
        const convertExpressReqToHandleRequest = (r: express.Request): import('openapi-backend').Request => ({
          method: r.method,
          path: r.path,
          headers: r.headers as Record<string, string | string[]>,
          query: r.query as Record<string, string | string[]>,
          body: r.body,
        });

        app.use(`/mock/${piece}`, async (req, res, next) => {
          try {
            await api.handleRequest(
              convertExpressReqToHandleRequest(req),
              req, 
              res
            );
          } catch (err) {
            next(err);
          }
        });
      }
    }
  } else {
    logger.error('Pieces directory could not be located in any of the candidate paths.');
    process.exit(1);
  }

  app.get('/health', (req, res) => res.send({ status: 'ok' }));

  // Global error handler
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const status = (err as any).status || (err as any).statusCode || 500;
    const expose = (err as any).expose === true;
    
    logger.error({ err, status, expose }, 'Unhandled mock gateway error');
    
    if (expose) {
      res.status(status).json({ error: 'Error', message: err.message });
    } else {
      res.status(status).json({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
    }
  });

  function normalizePort(val: string | undefined): number {
    const parsedPort = Number.parseInt(val || '4001', 10);
    if (Number.isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      logger.error(`Invalid port value: ${val}`);
      process.exit(1);
    }
    return parsedPort;
  }

  const validatedPort = normalizePort(process.env.PORT);
  app.listen(validatedPort, () => {
    logger.info(`Centralized Mock Gateway listening on port ${validatedPort}`);
  });
}

bootstrap().catch((err: Error) => {
  logger.error({ err }, 'Bootstrap failed');
  process.exit(1);
});
