import { Module } from '@nestjs/common';
import { BangocatController, BangocatPingController } from './bangocat.controller.js';
import { BangocatGateway } from './bangocat.gateway.js';
import { BangocatRoomService } from './bangocat-room.service.js';
import { BangocatConfig } from './bangocat.config.js';

@Module({
  controllers: [BangocatController, BangocatPingController],
  providers: [BangocatConfig, BangocatRoomService, BangocatGateway],
})
export class BangocatModule {}
