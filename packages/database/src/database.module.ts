import { Module, Global } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { DATABASE_CONNECTION } from './constants.js';
import { getDb, closeDb } from './client.js';
import { PostgresSavePointManager, SAVEPOINT_MANAGER } from './savepoint/savepoint.manager.js';

@Global()
@Module({
    providers: [
        {
            provide: DATABASE_CONNECTION,
            useFactory: () => {
                return getDb();
            },
        },
        {
            provide: SAVEPOINT_MANAGER,
            useClass: PostgresSavePointManager,
        },
    ],
    exports: [DATABASE_CONNECTION, SAVEPOINT_MANAGER],
})
export class DatabaseModule implements OnModuleDestroy {
    async onModuleDestroy(): Promise<void> {
        await closeDb();
    }
}
