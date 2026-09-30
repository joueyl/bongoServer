import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { BangocatEvents } from './bangocat.types.js';
import { BangocatRoomService } from './bangocat-room.service.js';
import { ChatDto, CreateRoomDto, JoinRoomDto, KickDto, ModelUpdateDto, SignalDto } from './dto/bangocat.dto.js';
import { validatePayload } from './dto/validate-payload.js';

/**
 * Bangocat 联机 WebSocket 网关，命名空间 /bangocat。
 *
 * 房间、聊天、房主、信令全部走 WebSocket；模型文件本身由客户端之间
 * 通过 WebRTC DataChannel 直传（P2P），本服务只转发 SDP/ICE 信令。
 */
@WebSocketGateway({ namespace: '/bangocat', cors: { origin: '*' } })
export class BangocatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(BangocatGateway.name);

  constructor(private readonly roomService: BangocatRoomService) {}

  afterInit(server: Server): void {
    this.roomService.attachServer(server);
  }

  handleConnection(client: Socket): void {
    this.logger.log(`client connected id=${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    // 断线视为退出房间：广播离开、必要时交接房主
    this.logger.log(`client disconnected id=${client.id}`);
    this.roomService.handleDisconnect(client.id);
  }

  @SubscribeMessage(BangocatEvents.ROOM_CREATE)
  async onCreate(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    const v = await validatePayload(CreateRoomDto, payload);
    if (!v.ok) {
      return this.logRejected('room:create', client.id, v.error);
    }
    return this.logResult(
      'room:create',
      client.id,
      this.roomService.createRoom(client.id, v.value),
    );
  }

  @SubscribeMessage(BangocatEvents.ROOM_JOIN)
  async onJoin(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    const v = await validatePayload(JoinRoomDto, payload);
    if (!v.ok) {
      return this.logRejected('room:join', client.id, v.error);
    }
    return this.logResult('room:join', client.id, this.roomService.joinRoom(client.id, v.value));
  }

  @SubscribeMessage(BangocatEvents.ROOM_LEAVE)
  onLeave(@ConnectedSocket() client: Socket) {
    return this.logResult('room:leave', client.id, this.roomService.leaveRoom(client.id));
  }

  @SubscribeMessage(BangocatEvents.ROOM_STATE)
  onState(@ConnectedSocket() client: Socket) {
    return this.logResult('room:state', client.id, this.roomService.getRoomView(client.id));
  }

  @SubscribeMessage(BangocatEvents.ROOM_KICK)
  async onKick(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    const v = await validatePayload(KickDto, payload);
    if (!v.ok) {
      return this.logRejected('room:kick', client.id, v.error);
    }
    return this.logResult(
      'room:kick',
      client.id,
      this.roomService.kickMember(client.id, v.value.memberId),
    );
  }

  @SubscribeMessage(BangocatEvents.ROOM_MODEL_UPDATE)
  async onModelUpdate(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    const v = await validatePayload(ModelUpdateDto, payload);
    if (!v.ok) {
      return this.logRejected('room:model-update', client.id, v.error);
    }
    return this.logResult(
      'room:model-update',
      client.id,
      this.roomService.updateModel(client.id, v.value.model),
    );
  }

  @SubscribeMessage(BangocatEvents.ROOM_CHAT)
  async onChat(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    const v = await validatePayload(ChatDto, payload);
    if (!v.ok) {
      return this.logRejected('room:chat', client.id, v.error);
    }
    return this.logResult(
      'room:chat',
      client.id,
      this.roomService.sendChat(client.id, v.value.content),
    );
  }

  @SubscribeMessage(BangocatEvents.PEER_SIGNAL)
  async onSignal(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    const v = await validatePayload(SignalDto, payload);
    if (!v.ok) {
      return this.logRejected('peer:signal', client.id, v.error);
    }
    return this.logResult(
      'peer:signal',
      client.id,
      this.roomService.relaySignal(client.id, v.value.to, v.value.data),
    );
  }

  private logRejected(event: string, clientId: string, error: string) {
    this.logger.warn(`request=${event} client=${clientId} rejected=${JSON.stringify(error)}`);
    return { ok: false as const, error };
  }

  private logResult<T extends object>(
    event: string,
    clientId: string,
    result: ({ ok: true } & T) | { ok: false; error: string },
  ) {
    if (result.ok) {
      const value = result as Record<string, unknown>;
      const nestedRoom = value.room as { roomId?: unknown } | undefined;
      const roomId =
        (typeof value.roomId === 'string' && value.roomId) ||
        (typeof nestedRoom?.roomId === 'string' && nestedRoom.roomId);
      this.logger.log(
        `request=${event} client=${clientId}${roomId ? ` room=${roomId}` : ''} result=ok`,
      );
    } else {
      this.logger.warn(`request=${event} client=${clientId} rejected=${JSON.stringify(result.error)}`);
    }
    return result;
  }
}
