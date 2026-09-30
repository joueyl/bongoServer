# Bangocat 联机服务接口

本文描述当前源码行为。HTTP 与 Socket.IO 共用端口，默认根地址为 `http://127.0.0.1:3000`。JSON 字段采用 `camelCase`，成员 ID 为 namespace 连接的 `socket.id`。

## 1. REST

### 连通性

`GET /test` 与 `GET /bangocat/test` 等价：

```json
{
  "ok": true,
  "service": "bangocat",
  "serverTime": "2026-09-30T02:10:49.048Z",
  "roomCount": 0,
  "maxRoomSize": 8,
  "uptimeSec": 4
}
```

`serverTime` 为 ISO 时间，`uptimeSec` 为进程运行秒数。`GET /` 返回模板文本 `Hello World!`，不包含房间服务状态。

### 大厅

`GET /bangocat/rooms` 返回按创建时间升序排列的摘要，不含成员明细或密码：

```json
{
  "ok": true,
  "rooms": [
    {
      "roomId": "K7XQ2M",
      "name": "测试房",
      "memberCount": 1,
      "maxMembers": 8,
      "hasPassword": true,
      "hostName": "小明",
      "createdAt": 1790726400000
    }
  ]
}
```

空列表为 `{ "ok": true, "rooms": [] }`。没有大厅变更广播；客户端在创建、退出或需要刷新时再次 GET。

## 2. Socket.IO 连接与回执

连接 namespace `/bangocat`，默认 Engine.IO 传输路径为 `/socket.io/`。本服务不是普通原生 WebSocket 协议端点，请使用 Socket.IO 兼容客户端。

```js
import { io } from 'socket.io-client';

const socket = io('http://127.0.0.1:3000/bangocat', {
  autoConnect: false,
  reconnection: false,
});

// 先安装广播监听，避免遗漏紧随请求发生的事件。
socket.on('room:chat', (message) => console.log(message));
socket.on('connect_error', (error) => console.error(error.message));
socket.on('disconnect', () => console.log('连接断开，清空本地房间状态'));

socket.once('connect', async () => {
  try {
    const result = await socket.timeout(5000).emitWithAck('room:create', {
      name: '小明',
      roomName: '我的房间',
    });
    if (!result.ok) throw new Error(result.error);
    console.log('已自动进入房间：', result.room);
    // 不要再 room:join 同一房间，否则会被拒绝。
    const response = await fetch('http://127.0.0.1:3000/bangocat/rooms');
    if (!response.ok) throw new Error(`大厅 HTTP ${response.status}`);
    console.log('更新大厅列表：', await response.json());
  } catch (error) {
    // 回执超时不代表服务端一定未执行，不要盲目重发创建请求。
    console.error(error);
  }
});
socket.connect();
```

业务回执：成功为 `{ "ok": true, ...业务字段 }`，拒绝为 `{ "ok": false, "error": "原因" }`。拒绝通常不会关闭连接；超时和连接错误单独处理。

Socket.IO 在线路协议中把回执参数封装在数组里。JavaScript 客户端会解包；其他语言客户端应按各自库的回调格式取出业务对象，不要把外层数组误判为拒绝。

除 `room:leave`、`room:state` 可不带 payload 外，请求 payload 必须是对象，不能为 `null` 或数组。`room:create` 的空对象 `{}` 合法。DTO 校验会移除未声明的顶层字段。

每个连接最多加入一个房间。断线视为退出；重连后 ID 改变，不会恢复原成员身份，须重新加入。

## 3. 客户端请求

| 事件 | payload | 成功回执的业务字段 |
| --- | --- | --- |
| `room:create` | `{ name?, roomName?, password?, model? }` | `{ room }` |
| `room:join` | `{ roomId, name?, password?, model? }` | `{ room }` |
| `room:leave` | 可省略 | `{ roomId }` |
| `room:state` | 可省略 | `{ room }` |
| `room:kick` | `{ memberId }` | `{ roomId }` |
| `room:model-update` | `{ model }` | `{ roomId, model }` |
| `room:chat` | `{ content }` | `{ roomId, sentAt }` |
| `peer:signal` | `{ to, data }` | 无额外字段，仅 `{ ok: true }` |

### 创建 / 加入

- `name` 可省略；提供时须为长度 `1–24` 的字符串。服务端去掉两端空白，缺省或 trim 后为空时使用 `匿名用户-<连接ID末4位>`。
- `roomName` 可省略；提供时长度 `1–24`，trim 后为空或缺省时使用房间号。
- 创建时 `password` 可省略，表示无密码；提供时长度 `1–32`，不要传空字符串表示无密码。
- 加入时 `roomId` 长度 `1–64`，服务端 trim 后转为大写查找。密码房间必须提供与原密码完全一致的 `password`，密码不进行 trim。
- `model` 可省略；未设置模型的成员在响应中为 `model: null`。
- 创建成功即成为房主并进入房间，无需再次加入。创建不发送 `room:member-joined`，创建者从回执获取房间和自身身份。
- 加入成功返回全量房间视图；只有房内其他成员收到 `room:member-joined`，加入者不会收到自己的入房广播。
- 已在任何房间的连接不能再创建或加入，包括重复加入同一房间。应先退出。

### 退出 / 踢人

房主退出或断线后，按加入顺序移交给最早的剩余成员；无人剩余则删除房间。退出不会主动断开 Socket.IO 连接。

`memberId` 为目标成员 socket ID，长度 `1–64`。只有房主可以踢同房间成员，不能踢自己。没有封禁功能；被踢成员连接保留，仍可再次加入。

### 聊天

`content` 为长度 `1–500` 的字符串。服务端不裁剪、不过滤消息内容；客户端需安全渲染，不应把内容作为 HTML 执行。

广播包含发送者本人。`sentAt` 为 Unix 毫秒时间戳。发送间隔由 `BANGOCAT_CHAT_MIN_INTERVAL_MS` 控制，按连接 ID 计算；退出房间但未断线不会重置限速。

聊天正文只即时广播，不保存在房间状态，也不写入操作日志；没有聊天历史查询接口。

### 模型元数据与信令

`model` 字段：`name` 可选字符串，`size` 可选数字，`hash` 可选字符串，`meta` 可选对象。示例：

```json
{
  "model": {
    "name": "cat.model3.json",
    "size": 2048,
    "hash": "client-computed-hash",
    "meta": { "version": "v2" }
  }
}
```

`room:model-update` 的 `model` 必须提供，替换当前元数据而非增量合并；广播只发给其他成员。

`peer:signal` 的 `to` 为长度 `1–64` 的 socket ID，`data` 必须是对象。发送者必须在房间中，目标须属于同房间。服务端不解释 SDP / ICE，也不负责建立 DataChannel、拆分文件、校验文件或提供 STUN / TURN。

模型文件传输必须由客户端实现；若使用 TURN，文件中继流量由 TURN 服务承担，不能保证所有网络环境下均为直连。

## 4. 服务端广播

| 事件 | payload | 接收范围 |
| --- | --- | --- |
| `room:member-joined` | `{ roomId, member }` | 房内其他成员，不含新加入者 |
| `room:member-left` | `{ roomId, memberId, reason, newHostId }` | 离开后仍在房内的成员 |
| `room:kicked` | `{ roomId, reason: "kicked" }` | 仅被踢成员 |
| `room:model-updated` | `{ roomId, memberId, model }` | 房内其他成员，不含更新者 |
| `room:chat` | `{ roomId, fromId, fromName, content, sentAt }` | 全体房内成员，含发送者 |
| `peer:signal` | `{ roomId, from, data }` | 指定目标连接 |

`reason` 为 `left`、`kicked` 或 `disconnected`。`newHostId` 在房主接任时为新房主 ID，其他情况为 `null`。离开者依据成功回执、断线事件或 `room:kicked` 清空本地身份，不能等待自己的离开广播。

广播可能先于对应请求的回执到达，应提前安装监听；成员按 ID 合并，避免重复记录。

## 5. 完整房间结构

```json
{
  "ok": true,
  "room": {
    "roomId": "K7XQ2M",
    "name": "测试房",
    "hostId": "host-socket-id",
    "memberCount": 1,
    "maxMembers": 8,
    "hasPassword": true,
    "createdAt": 1790726400000,
    "members": [
      {
        "id": "host-socket-id",
        "name": "小明",
        "model": null,
        "isHost": true,
        "joinedAt": 1790726400000
      }
    ]
  }
}
```

`createdAt`、`joinedAt` 均为 Unix 毫秒时间戳。`memberCount` 包含房主。密码不会返回给客户端。通过 `member.id === socket.id` 判断本人，通过 `isHost` 或 `hostId` 判断房主。

## 6. 常见拒绝原因

| 情况 | 回执 `error` 示例 |
| --- | --- |
| 已在房间中 | `已经在房间中，请先退出当前房间` |
| 房间不存在 | `房间不存在或已解散` |
| 密码不匹配 | `房间密码错误` |
| 房间已满 | `房间人数已满（上限 8 人）` |
| 服务器房间数达到上限 | `服务器房间数已达上限（100）` |
| 未在房间中 | `当前不在任何房间中` |
| 非房主踢人 | `只有房主才能踢人` |
| 踢自己 | `不能踢自己，请使用退出房间` |
| 目标不在同房间 | `目标成员不在本房间中` |
| 聊天过快 | `发送太频繁，请稍候（间隔至少 300ms）` |
| payload 类型错误 | `payload 必须是对象` |

DTO 校验错误还可能包含字段名称和长度要求。当前没有独立的机器可读错误码，客户端不应把失败回执当成成功房间结构。

配置与启动见 [项目说明](../README.md)，部署、日志和安全限制见 [部署文档](deployment.md)。
