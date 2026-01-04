import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { ZitadelModule } from './zitadel/zitadel.module';

@Module({
  imports: [ZitadelModule, UsersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
