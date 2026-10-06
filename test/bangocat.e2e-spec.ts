import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { BangocatModule } from '../src/bangocat/bangocat.module.js';
import { BangocatEvents } from '../src/bangocat/bangocat.types.js';

let app: INestApplication;
let baseUrl: string;

async function connect(): Promise<ClientSocket> {
  const socket = io(`${baseUrl}/bangocat`, { transports: ['websocket'] });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (e) => reject(e));
  });
  return socket;
}

async function ack(socket: ClientSocket, event: string, payload?: unknown): Promise<any> {
  // 超时会 reject，成功时 resolve 服务端返回的 ack 数据
  return socket.timeout(2000).emitWithAck(event, payload);
}

function nextEvent(socket: ClientSocket, event: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待事件 ${event} 超时`)), 2000);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

describe('Bangocat REST (e2e)', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), BangocatModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /test 返回连通性信息', async () => {
    const res = (await (await fetch(`${baseUrl}/test`)).json()) as any;
    expect(res.ok).toBe(true);
    expect(res.service).toBe('bangocat');
    expect(res.maxRoomSize).toBeGreaterThan(0);
  });

  it('GET /bangocat/test 返回连通性信息', async () => {
    const res = (await (await fetch(`${baseUrl}/bangocat/test`)).json()) as any;
    expect(res.ok).toBe(true);
    expect(res.service).toBe('bangocat');
  });

  it('GET /bangocat/rooms 返回房间列表', async () => {
    const res = (await (await fetch(`${baseUrl}/bangocat/rooms`)).json()) as any;
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.rooms)).toBe(true);
  });
});

describe('Bangocat 房间流程 (e2e)', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), BangocatModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('省略昵称自动生成，并在加入响应中返回准确的成员身份', async () => {
    const host = await connect();
    const guest = await connect();
    try {
      const created = await ack(host, BangocatEvents.ROOM_CREATE, {
        roomName: '匿名测试',
      });
      expect(created.ok).toBe(true);
      expect(created.memberId).toBe(host.id);
      const hostMember = created.room.members.find(
        (member: any) => member.id === host.id,
      );
      expect(hostMember.name).toBe(`匿名用户-${host.id!.slice(-4)}`);
      const joined = await ack(guest, BangocatEvents.ROOM_JOIN, {
        roomId: created.room.roomId,
      });
      expect(joined.ok).toBe(true);
      expect(joined.memberId).toBe(guest.id);
      const guestMember = joined.room.members.find(
        (member: any) => member.id === guest.id,
      );
      expect(guestMember.name).toBe(`匿名用户-${guest.id!.slice(-4)}`);
      const received = nextEvent(host, BangocatEvents.CHAT);
      expect(
        (await ack(guest, BangocatEvents.ROOM_CHAT, { content: '你好' })).ok,
      ).toBe(true);
      expect((await received).fromId).toBe(guest.id);
    } finally {
      host.disconnect();
      guest.disconnect();
    }
  });

  it('创建→密码校验→加入→聊天→模型更新→P2P信令→踢人→房主接任', async () => {
    const host = await connect();
    const alice = await connect();
    const bob = await connect();

    // 1. 创建带密码的房间，创建者为房主
    const created = await ack(host, BangocatEvents.ROOM_CREATE, {
      name: 'host',
      roomName: '测试房',
      password: '1234',
      model: { name: 'host.glb', size: 1024 },
    });
    expect(created.ok).toBe(true);
    const roomId: string = created.room.roomId;
    expect(created.room.hasPassword).toBe(true);
    expect(created.room.memberCount).toBe(1);
    expect(created.room.members[0].isHost).toBe(true);

    // 2. 密码错误无法加入
    const bad = await ack(alice, BangocatEvents.ROOM_JOIN, { roomId, name: 'alice', password: 'wrong' });
    expect(bad.ok).toBe(false);

    // 3. 密码正确加入，携带模型元数据（先在房主侧注册监听再发 join）
    const hostSawAlice = nextEvent(host, BangocatEvents.MEMBER_JOINED);
    const joined = await ack(alice, BangocatEvents.ROOM_JOIN, {
      roomId,
      name: 'alice',
      password: '1234',
      model: { name: 'alice.glb', size: 2048 },
    });
    expect(joined.ok).toBe(true);
    expect(joined.room.memberCount).toBe(2);
    expect(joined.room.members.find((m: any) => m.name === 'alice')?.model?.name).toBe('alice.glb');
    expect(joined.room.members.find((m: any) => m.name === 'alice')?.isHost).toBe(false);

    expect((await hostSawAlice).member.name).toBe('alice');

    // 4. bob 无密码房间校验通过（房间有密码必须带）
    const bobBad = await ack(bob, BangocatEvents.ROOM_JOIN, { roomId, name: 'bob' });
    expect(bobBad.ok).toBe(false);

    const hostSawBob = nextEvent(host, BangocatEvents.MEMBER_JOINED);
    await ack(bob, BangocatEvents.ROOM_JOIN, { roomId, name: 'bob', password: '1234' });
    expect((await hostSawBob).member.name).toBe('bob');

    // 5. 聊天广播给房间内所有人，服务器不保存
    const hostChat = nextEvent(host, BangocatEvents.CHAT);
    const aliceChat = nextEvent(alice, BangocatEvents.CHAT);
    const sent = await ack(bob, BangocatEvents.ROOM_CHAT, { content: '大家好' });
    expect(sent.ok).toBe(true);
    const chats = await Promise.all([hostChat, aliceChat]);
    for (const evt of chats) {
      expect(evt.content).toBe('大家好');
      expect(evt.fromName).toBe('bob');
      expect(evt.roomId).toBe(roomId);
    }

    // 6. 成员更新模型 → 房间其他人收到更新通知
    const hostModel = nextEvent(host, BangocatEvents.MODEL_UPDATED);
    const bobModel = nextEvent(bob, BangocatEvents.MODEL_UPDATED);
    const updated = await ack(alice, BangocatEvents.ROOM_MODEL_UPDATE, {
      model: { name: 'alice-v2.glb', hash: 'h2' },
    });
    expect(updated.ok).toBe(true);
    const modelEvts = await Promise.all([hostModel, bobModel]);
    for (const evt of modelEvts) {
      expect(evt.memberId).toBe(alice.id);
      expect(evt.model.name).toBe('alice-v2.glb');
    }

    // 7. P2P 信令转发：alice → bob（服务器只转发，不解析内容）
    const bobSignal = nextEvent(bob, BangocatEvents.SIGNAL);
    const sigAck = await ack(alice, BangocatEvents.PEER_SIGNAL, {
      to: bob.id,
      data: { type: 'offer', sdp: 'fake-sdp' },
    });
    expect(sigAck.ok).toBe(true);
    const signal = await bobSignal;
    expect(signal.from).toBe(alice.id);
    expect(signal.data.type).toBe('offer');
    expect(signal.roomId).toBe(roomId);

    // 8. 非房主不能踢人
    const kickDenied = await ack(bob, BangocatEvents.ROOM_KICK, { memberId: alice.id });
    expect(kickDenied.ok).toBe(false);

    // 9. 房主踢人：被踢者收到 room:kicked，其他人收到 member-left
    const aliceKicked = nextEvent(alice, BangocatEvents.KICKED);
    const bobSawKick = nextEvent(bob, BangocatEvents.MEMBER_LEFT);
    await ack(host, BangocatEvents.ROOM_KICK, { memberId: alice.id });
    expect((await aliceKicked).roomId).toBe(roomId);
    const leftEvt = await bobSawKick;
    expect(leftEvt.memberId).toBe(alice.id);
    expect(leftEvt.reason).toBe('kicked');

    // 10. 房主断线 → 按加入先后由 bob 接任房主
    const hostId = host.id; // disconnect 后客户端 socket.id 会被清空，先存下来
    const bobSawLeave = nextEvent(bob, BangocatEvents.MEMBER_LEFT);
    host.disconnect();
    const succession = await bobSawLeave;
    expect(succession.memberId).toBe(hostId);
    expect(succession.reason).toBe('disconnected');
    expect(succession.newHostId).toBe(bob.id);

    const state = await ack(bob, BangocatEvents.ROOM_STATE);
    expect(state.ok).toBe(true);
    expect(state.room.hostId).toBe(bob.id);
    expect(state.room.memberCount).toBe(1);

    alice.close();
    bob.close();
  });
});

describe('Bangocat 人数上限 (e2e)', () => {
  beforeAll(async () => {
    process.env.BANGOCAT_MAX_ROOM_SIZE = '2';
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), BangocatModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.BANGOCAT_MAX_ROOM_SIZE;
  });

  it('超过 env 配置的人数上限后加入失败', async () => {
    const a = await connect();
    const b = await connect();
    const c = await connect();

    const created = await ack(a, BangocatEvents.ROOM_CREATE, { name: 'a' });
    expect(created.ok).toBe(true);
    const roomId: string = created.room.roomId;
    expect(created.room.maxMembers).toBe(2);

    const joined = await ack(b, BangocatEvents.ROOM_JOIN, { roomId, name: 'b' });
    expect(joined.ok).toBe(true);

    const full = await ack(c, BangocatEvents.ROOM_JOIN, { roomId, name: 'c' });
    expect(full.ok).toBe(false);

    [a, b, c].forEach((s) => s.close());
  });
});
