import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Bangocat 可变配置，全部来自环境变量（.env），改完重启服务生效。
 */
@Injectable()
export class BangocatConfig {
  constructor(private readonly configService: ConfigService) {}

  /** 单个房间人数上限 */
  get maxRoomSize(): number {
    return this.int('BANGOCAT_MAX_ROOM_SIZE', 8, 2, 100_000);
  }

  /** 服务器允许同时存在的房间总数上限 */
  get maxRooms(): number {
    return this.int('BANGOCAT_MAX_ROOMS', 100, 1, 1_000_000);
  }

  /** 房间号长度（4-32，字符集不含易混淆的 0/O/1/I） */
  get roomIdLength(): number {
    return this.int('BANGOCAT_ROOM_ID_LENGTH', 6, 4, 32);
  }

  /** 同一成员两条聊天消息的最小间隔（毫秒），0 表示不限制 */
  get chatMinIntervalMs(): number {
    return this.int('BANGOCAT_CHAT_MIN_INTERVAL_MS', 300, 0, 60_000);
  }

  private int(key: string, fallback: number, min: number, max: number): number {
    const raw = this.configService.get<string>(key);
    const value = raw === undefined || raw === '' ? fallback : Number(raw);
    if (!Number.isFinite(value)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.trunc(value)));
  }
}
