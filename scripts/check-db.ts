import { db } from '@nexiom/database';
async function run() {
  const res = await db.query.appConnections.findMany();
  console.log('App Connections in DB:', JSON.stringify(res.map(c => ({ id: c.id, appName: c.appName, externalId: c.externalId, status: c.status, metadata: c.metadata })), null, 2));
  process.exit(0);
}
run();
