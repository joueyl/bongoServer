/** 成员携带的模型文件描述，具体文件内容走 P2P，不经过服务器 */
export interface BangocatModelInfo {
  /** 模型文件名，例如 cat-v2.glb */
  name?: string;
  /** 文件大小（字节） */
  size?: number;
  /** 文件哈希 / 版本号，用于判断是否需要重新拉取 */
  hash?: string;
  /** 其他自定义元数据，原样透传给房间内其他成员 */
  meta?: Record<string, unknown>;
}

/** 房间成员视图（返回给客户端的成员信息） */
export interface BangocatMemberView {
  /** 成员 id，即 socket id */
  id: string;
  /** 昵称 */
  name: string;
  /** 该成员的模型信息，用于发起 P2P 拉取 */
  model: BangocatModelInfo | null;
  /** 是否为当前房主 */
  isHost: boolean;
  /** 加入时间戳（毫秒） */
  joinedAt: number;
}

/** 房间完整视图（房内成员可见） */
export interface BangocatRoomView {
  roomId: string;
  name: string;
  hostId: string;
  memberCount: number;
  maxMembers: number;
  hasPassword: boolean;
  createdAt: number;
  members: BangocatMemberView[];
}

/** 房间摘要（大厅列表用，不含成员明细与密码） */
export interface BangocatRoomSummary {
  roomId: string;
  name: string;
  memberCount: number;
  maxMembers: number;
  hasPassword: boolean;
  hostName: string;
  createdAt: number;
}

/** 离开房间的原因 */
export type BangocatLeaveReason = 'left' | 'kicked' | 'disconnected';

/** 所有 WebSocket 消息（含 ack）的统一事件名 */
export const BangocatEvents = {
  // ---- client -> server ----
  ROOM_CREATE: 'room:create',
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
  ROOM_STATE: 'room:state',
  ROOM_KICK: 'room:kick',
  ROOM_MODEL_UPDATE: 'room:model-update',
  ROOM_CHAT: 'room:chat',
  PEER_SIGNAL: 'peer:signal',
  // ---- server -> client ----
  MEMBER_JOINED: 'room:member-joined',
  MEMBER_LEFT: 'room:member-left',
  KICKED: 'room:kicked',
  MODEL_UPDATED: 'room:model-updated',
  CHAT: 'room:chat',
  SIGNAL: 'peer:signal',
} as const;
