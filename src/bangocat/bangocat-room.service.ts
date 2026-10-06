import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Server } from 'socket.io';
import { BangocatConfig } from './bangocat.config.js';
import {
  BangocatEvents,
  BangocatLeaveReason,
  BangocatMemberView,
  BangocatModelInfo,
  BangocatRoomSummary,
  BangocatRoomView,
} from './bangocat.types.js';
import { CreateRoomDto, JoinRoomDto, ModelInfoDto } from './dto/bangocat.dto.js';

/** 所有 ack 的统一返回结构 */
export type Ack<T> = ({ ok: true } & T) | { ok: false; error: string };

const ok = <T>(data: T): Ack<T> => ({ ok: true, ...data });
const err = (error: string): Ack<never> => ({ ok: false, error });

interface InternalMember {
  clientId: string;
  name: string;
  model: BangocatModelInfo | null;
  joinedAt: number;
}

interface InternalRoom {
  id: string;
  name: string;
  /** 明文仅存于内存，进程重启即消失，不落库不写日志 */
  password: string | null;
  hostId: string;
  /** Map 保持插入顺序，即加入房间的先后顺序，房主接任取第一个 */
  members: Map<string, InternalMember>;
  createdAt: number;
}

/**
 * Bangocat 联机房间状态管理。纯内存实现，不持久化任何数据（包括聊天消息）。
 * 所有对客户端的广播由本服务通过 socket.io server 直接发出。
 */
@Injectable()
export class BangocatRoomService {
  private readonly rooms = new Map<string, InternalRoom>();
  private readonly lastChatAt = new Map<string, number>();
  private server: Server | null = null;

  constructor(private readonly config: BangocatConfig) {}

  /** 网关初始化时注入 socket.io server */
  attachServer(server: Server): void {
    this.server = server;
  }

  ping() {
    return {
      ok: true,
      service: 'bangocat',
      serverTime: new Date().toISOString(),
      roomCount: this.rooms.size,
      maxRoomSize: this.config.maxRoomSize,
      uptimeSec: Math.round(process.uptime()),
    };
  }

  createRoom(clientId: string, dto: CreateRoomDto): Ack<{ room: BangocatRoomView; memberId: string }> {
    if (this.findRoomByClient(clientId)) {
      return err('已经在房间中，请先退出当前房间');
    }
    if (this.rooms.size >= this.config.maxRooms) {
      return err(`服务器房间数已达上限（${this.config.maxRooms}）`);
    }
    const roomId = this.generateRoomId();
    const room: InternalRoom = {
      id: roomId,
      name: dto.roomName?.trim() || roomId,
      password: dto.password ?? null,
      hostId: clientId,
      members: new Map(),
      createdAt: Date.now(),
    };
    room.members.set(clientId, {
      clientId,
      name: this.memberName(dto.name, clientId),
      model: dto.model ?? null,
      joinedAt: Date.now(),
    });
    this.rooms.set(roomId, room);
    this.server?.in(clientId).socketsJoin(this.roomKey(roomId));
    return ok({ room: this.toView(room), memberId: clientId });
  }

  joinRoom(clientId: string, dto: JoinRoomDto): Ack<{ room: BangocatRoomView; memberId: string }> {
    if (this.findRoomByClient(clientId)) {
      return err('已经在房间中，请先退出当前房间');
    }
    const room = this.rooms.get(dto.roomId.trim().toUpperCase());
    if (!room) {
      return err('房间不存在或已解散');
    }
    if (room.password !== null && dto.password !== room.password) {
      return err('房间密码错误');
    }
    if (room.members.size >= this.config.maxRoomSize) {
      return err(`房间人数已满（上限 ${this.config.maxRoomSize} 人）`);
    }
    const member: InternalMember = {
      clientId,
      name: this.memberName(dto.name, clientId),
      model: dto.model ?? null,
      joinedAt: Date.now(),
    };
    room.members.set(clientId, member);
    this.server?.in(clientId).socketsJoin(this.roomKey(room.id));
    // 通知房间内其他人：新人加入（携带其模型信息，供大家发起 P2P）
    this.server
      ?.to(this.roomKey(room.id))
      .except(clientId)
      .emit(BangocatEvents.MEMBER_JOINED, {
        roomId: room.id,
        member: this.toMemberView(room, member),
      });
    return ok({ room: this.toView(room), memberId: clientId });
  }

  leaveRoom(clientId: string): Ack<{ roomId: string }> {
    const found = this.findRoomByClient(clientId);
    if (!found) {
      return err('当前不在任何房间中');
    }
    const { room } = found;
    room.members.delete(clientId);
    const newHostId = room.hostId === clientId ? this.promoteHost(room) : null;
    this.server?.in(clientId).socketsLeave(this.roomKey(room.id));
    this.server?.to(this.roomKey(room.id)).emit(BangocatEvents.MEMBER_LEFT, {
      roomId: room.id,
      memberId: clientId,
      reason: 'left' satisfies BangocatLeaveReason,
      newHostId,
    });
    this.disposeRoomIfEmpty(room);
    return ok({ roomId: room.id });
  }

  kickMember(hostClientId: string, memberId: string): Ack<{ roomId: string }> {
    const found = this.findRoomByClient(hostClientId);
    if (!found) {
      return err('当前不在任何房间中');
    }
    const { room } = found;
    if (room.hostId !== hostClientId) {
      return err('只有房主才能踢人');
    }
    if (memberId === hostClientId) {
      return err('不能踢自己，请使用退出房间');
    }
    const target = room.members.get(memberId);
    if (!target) {
      return err('目标成员不在本房间中');
    }
    room.members.delete(memberId);
    // 先单独通知被踢者，再广播房间
    this.server?.in(memberId).emit(BangocatEvents.KICKED, { roomId: room.id, reason: 'kicked' });
    this.server?.in(memberId).socketsLeave(this.roomKey(room.id));
    this.server?.to(this.roomKey(room.id)).emit(BangocatEvents.MEMBER_LEFT, {
      roomId: room.id,
      memberId,
      reason: 'kicked' satisfies BangocatLeaveReason,
      newHostId: null,
    });
    this.disposeRoomIfEmpty(room);
    return ok({ roomId: room.id });
  }

  updateModel(clientId: string, model: ModelInfoDto): Ack<{ roomId: string; model: ModelInfoDto }> {
    const found = this.findRoomByClient(clientId);
    if (!found) {
      return err('当前不在任何房间中');
    }
    found.member.model = model;
    // 通知房间内其他人：该成员模型已更新，其他人可重新与其建立 P2P 拉取新模型
    this.server
      ?.to(this.roomKey(found.room.id))
      .except(clientId)
      .emit(BangocatEvents.MODEL_UPDATED, {
        roomId: found.room.id,
        memberId: clientId,
        model,
      });
    return ok({ roomId: found.room.id, model });
  }

  sendChat(clientId: string, content: string): Ack<{ roomId: string; sentAt: number }> {
    const found = this.findRoomByClient(clientId);
    if (!found) {
      return err('当前不在任何房间中');
    }
    const now = Date.now();
    const minInterval = this.config.chatMinIntervalMs;
    if (minInterval > 0) {
      const last = this.lastChatAt.get(clientId) ?? 0;
      if (now - last < minInterval) {
        return err(`发送太频繁，请稍候（间隔至少 ${minInterval}ms）`);
      }
      this.lastChatAt.set(clientId, now);
    }
    this.server?.to(this.roomKey(found.room.id)).emit(BangocatEvents.CHAT, {
      roomId: found.room.id,
      fromId: clientId,
      fromName: found.member.name,
      content,
      sentAt: now,
    });
    return ok({ roomId: found.room.id, sentAt: now });
  }

  relaySignal(fromId: string, to: string, data: Record<string, unknown>): Ack<object> {
    const found = this.findRoomByClient(fromId);
    if (!found) {
      return err('当前不在任何房间中');
    }
    if (!found.room.members.has(to)) {
      return err('目标成员不在本房间中');
    }
    // 仅转发 WebRTC 信令（SDP / ICE），模型文件本身不走服务器
    this.server?.in(to).emit(BangocatEvents.SIGNAL, { roomId: found.room.id, from: fromId, data });
    return ok({});
  }

  getRoomView(clientId: string): Ack<{ room: BangocatRoomView }> {
    const found = this.findRoomByClient(clientId);
    if (!found) {
      return err('当前不在任何房间中');
    }
    return ok({ room: this.toView(found.room) });
  }

  /** 断线清理：移出房间、必要时交接房主并广播 */
  handleDisconnect(clientId: string, reason: BangocatLeaveReason = 'disconnected'): void {
    this.lastChatAt.delete(clientId);
    const found = this.findRoomByClient(clientId);
    if (!found) {
      return;
    }
    const { room } = found;
    room.members.delete(clientId);
    const newHostId = room.hostId === clientId ? this.promoteHost(room) : null;
    this.server?.to(this.roomKey(room.id)).emit(BangocatEvents.MEMBER_LEFT, {
      roomId: room.id,
      memberId: clientId,
      reason,
      newHostId,
    });
    this.disposeRoomIfEmpty(room);
  }

  listRooms(): BangocatRoomSummary[] {
    return [...this.rooms.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((room) => ({
        roomId: room.id,
        name: room.name,
        memberCount: room.members.size,
        maxMembers: this.config.maxRoomSize,
        hasPassword: room.password !== null,
        hostName: room.members.get(room.hostId)?.name ?? '',
        createdAt: room.createdAt,
      }));
  }

  /** 房主退出/掉线后，按加入先后顺序把房主交给最早的成员 */
  private promoteHost(room: InternalRoom): string | null {
    const next = room.members.keys().next();
    if (next.done) {
      return null;
    }
    room.hostId = next.value;
    return room.hostId;
  }

  private disposeRoomIfEmpty(room: InternalRoom): void {
    if (room.members.size === 0) {
      this.rooms.delete(room.id);
    }
  }

  private findRoomByClient(clientId: string): { room: InternalRoom; member: InternalMember } | null {
    for (const room of this.rooms.values()) {
      const member = room.members.get(clientId);
      if (member) {
        return { room, member };
      }
    }
    return null;
  }

  private generateRoomId(): string {
    // 字符集去掉易混淆的 0/O/1/I
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const length = this.config.roomIdLength;
    for (let attempt = 0; attempt < 50; attempt++) {
      const bytes = randomBytes(length);
      let id = '';
      for (let i = 0; i < length; i++) {
        id += alphabet[bytes[i] % alphabet.length];
      }
      if (!this.rooms.has(id)) {
        return id;
      }
    }
    throw new Error('无法分配房间号，请稍后重试');
  }

  private roomKey(roomId: string): string {
    return `bangocat:room:${roomId}`;
  }

  private memberName(name: string | undefined, clientId: string): string {
    const trimmed = name?.trim();
    return trimmed || `匿名用户-${clientId.slice(-4)}`;
  }

  private toMemberView(room: InternalRoom, member: InternalMember): BangocatMemberView {
    return {
      id: member.clientId,
      name: member.name,
      model: member.model,
      isHost: room.hostId === member.clientId,
      joinedAt: member.joinedAt,
    };
  }

  private toView(room: InternalRoom): BangocatRoomView {
    return {
      roomId: room.id,
      name: room.name,
      hostId: room.hostId,
      memberCount: room.members.size,
      maxMembers: this.config.maxRoomSize,
      hasPassword: room.password !== null,
      createdAt: room.createdAt,
      members: [...room.members.values()].map((m) => this.toMemberView(room, m)),
    };
  }
}
