import { Module, Global } from '@nestjs/common';
import { DATABASE_CONNECTION } from './constants.js';
import { getDb } from './client.js';

@Global()
@Module({
    providers: [
        {
            provide: DATABASE_CONNECTION,
            useFactory: () => {
                return getDb();
            },
        },
    ],
    exports: [DATABASE_CONNECTION],
})
export class DatabaseModule { }
