import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { ZitadelModule } from '../zitadel/zitadel.module';

@Module({
    imports: [ZitadelModule],
    controllers: [UsersController],
    providers: [UsersService],
})
export class UsersModule { }
