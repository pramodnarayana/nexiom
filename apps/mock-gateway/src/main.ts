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

// Depending on if we run from the app root (`node apps/mock-gateway/dist/main.js`) 
// or from Docker (`node /app/apps/mock-gateway/dist/main.js`), the packages logic shifts.
let piecesDir = join(process.cwd(), '../../packages/pieces');
if (!existsSync(piecesDir)) {
  piecesDir = join(process.cwd(), 'packages/pieces');
  if (!existsSync(piecesDir)) {
    // Docker execution context where apps/mock-gateway runs from /app
    piecesDir = join(process.cwd(), '../packages/pieces');
  }
}

if (existsSync(piecesDir)) {
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
            const mock = await c.api.mockResponseForOperation(c.operation.operationId as string || c.operation.path);
            return res.status(200).json(mock);
          } catch (e: unknown) {
            logger.warn({ err: e }, `Failed to generate strict OpenAPI mock for ${piece} ${req.path}`);
            return res.status(200).json({ id: 'dummy-success', status: 'mocked' });
          }
        },
        validationFail: (c, req, res) => res.status(400).json({ err: c.validation.errors }),
      });
      
      api.init();
      
      logger.info(`Mounted mock proxy for ${piece} at /mock/${piece}`);
      
      app.use(`/mock/${piece}`, (req, res) => api.handleRequest(
        req as never, 
        req, 
        res
      ));
    }
  }
} else {
  logger.error(`Pieces directory could not be located at ${piecesDir}`);
}

app.get('/health', (req, res) => res.send({ status: 'ok' }));

const port = process.env.PORT || 4001;
app.listen(port, () => {
  logger.info(`Centralized Mock Gateway listening on port ${port}`);
});
