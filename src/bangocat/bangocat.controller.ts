import { Controller, Get } from '@nestjs/common';
import { BangocatRoomService } from './bangocat-room.service.js';

@Controller('bangocat')
export class BangocatController {
  constructor(private readonly roomService: BangocatRoomService) {}

  /** bangocat 服务连通性测试（命名空间写法） */
  @Get('test')
  test() {
    return this.roomService.ping();
  }

  /** 大厅：当前所有房间摘要（不包含密码与成员明细） */
  @Get('rooms')
  listRooms() {
    return { ok: true, rooms: this.roomService.listRooms() };
  }
}

@Controller()
export class BangocatPingController {
  constructor(private readonly roomService: BangocatRoomService) {}

  /** bangocat 服务连通性测试（根路径 /test） */
  @Get('test')
  test() {
    return this.roomService.ping();
  }
}
