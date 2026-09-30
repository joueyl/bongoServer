import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { BangocatModule } from './bangocat/bangocat.module.js';

@Module({
  imports: [
    // 读取项目根目录 .env（Bangocat 的可变配置都在里面）
    ConfigModule.forRoot({ isGlobal: true }),
    BangocatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
