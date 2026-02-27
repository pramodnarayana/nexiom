import { Module, Global } from '@nestjs/common';
import { DATABASE_CONNECTION } from './constants';
import { getDb } from './client';

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
