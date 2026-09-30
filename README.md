# Bango Server

BongoCat 客户端的联机服务端，基于 NestJS、TypeScript 和 Socket.IO。提供房间管理、聊天广播、模型元数据同步及 WebRTC 信令转发。

项目目录名是 `bango-server`；接口中的服务名、路径和环境变量前缀沿用 `bangocat`，接入时请勿混用。

## 功能与边界

- 创建房间后，创建者自动加入并成为房主，不需要再次发送加入请求。
- 支持房间密码、人数限制、房主踢人；房主退出或断线后，由最早加入的剩余成员接任。
- 最后一名成员退出或断线后，自动销毁房间。
- 大厅通过 HTTP 获取房间列表；创建、加入、聊天等操作通过 Socket.IO 完成。
- 聊天广播给房间内所有成员，包括发送者；不保存聊天历史。
- 仅同步模型元数据和转发 WebRTC 信令，不上传、存储或转发模型文件。
- 房间状态仅存于当前进程内存，重启后清空；没有数据库、账号认证或多实例共享状态。

## 快速启动

本地已验证环境：Node.js `22.18.0`、pnpm `10.26.1`。请使用与依赖兼容的 Node.js 和 pnpm；提交并保留 `pnpm-lock.yaml`。

在项目根目录执行：

```sh
pnpm install --frozen-lockfile
```

首次启动时创建本地配置。若 `.env` 已存在，请直接编辑，不要覆盖。

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

Linux / macOS：

```sh
cp .env.example .env
```

启动开发服务：

```sh
pnpm start:dev
```

默认端口为 `3000`，按 `Ctrl+C` 停止。客户端填写服务根地址，例如 `http://127.0.0.1:3000`，不要填写 `/bangocat/rooms`。

连通性检查：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/test
Invoke-RestMethod http://127.0.0.1:3000/bangocat/rooms
```

没有房间时返回 `{ "ok": true, "rooms": [] }`，属于正常状态。

## 配置

配置模板见 [.env.example](.env.example)。应用从项目根目录读取 `.env`，已有进程环境变量优先；修改文件后重启服务。

| 变量 | 默认值 | 用途 / 范围 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 与 Socket.IO 共用端口 |
| `BANGOCAT_MAX_ROOM_SIZE` | `8` | 房间人数上限，含房主，`2–100000` |
| `BANGOCAT_MAX_ROOMS` | `100` | 同时存在的房间数上限，`1–1000000` |
| `BANGOCAT_ROOM_ID_LENGTH` | `6` | 房间号长度，`4–32` |
| `BANGOCAT_CHAT_MIN_INTERVAL_MS` | `300` | 同一连接聊天发送最小间隔，`0–60000` 毫秒，`0` 不限制 |

四项 `BANGOCAT_*` 数值缺失、为空或无法转换成有限数值时使用默认值；小数截断，超出范围的值限制到边界。`PORT` 不使用这套校验逻辑。

`.env` 被 Git 忽略，不要提交真实密码或密钥；`.env.example` 应提交。

## 接口与客户端接入

| 通道 | 地址 | 用途 |
| --- | --- | --- |
| HTTP | `GET /test` 或 `GET /bangocat/test` | 连通性、房间数、运行时间 |
| HTTP | `GET /bangocat/rooms` | 大厅房间摘要 |
| Socket.IO | namespace `/bangocat`，默认传输路径 `/socket.io/` | 房间、聊天、模型元数据及信令 |

客户端必须等待 Socket.IO 的 `connect` 事件后再发送请求，并检查回执中的 `ok`。创建成功后直接采用回执中的 `room`，再获取大厅列表；服务端没有大厅列表变更推送。

事件、参数、响应及完整示例见 [接口文档](docs/bangocat-api.md)。

## 开发与验证

```sh
pnpm build
pnpm lint
pnpm test
pnpm test:e2e
```

其他命令：`pnpm start` 普通启动，`pnpm start:debug` 调试启动，`pnpm test:watch` 测试监听，`pnpm test:cov` 覆盖率，`pnpm format` 格式化源码及测试文件。

端到端测试自动启动临时端口，无需预先启动服务。当前用例覆盖 REST、创建与加入、密码校验、聊天、模型元数据、信令转发、踢人、房主接任和人数上限。

## 生产运行

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start:prod
```

构建入口产物为 `dist/main.js`。从项目根目录运行，使用进程管理工具维护进程，并通过反向代理提供 HTTPS / WSS；详见 [部署与排障](docs/deployment.md)。

目前 REST 与 Socket.IO 的跨域配置均放开，且没有账号认证，不能直接视为已具备完整公网安全防护。

## 项目结构

```text
src/
  main.ts                     服务入口、HTTP CORS、监听端口
  app.module.ts               配置与模块装配
  bangocat/
    bangocat.controller.ts    REST 连通性与大厅
    bangocat.gateway.ts       Socket.IO 网关与操作日志
    bangocat-room.service.ts  内存房间、房主、聊天限速、信令转发
    bangocat.config.ts        房间配置
    bangocat.types.ts         事件名与响应类型
    dto/                      请求参数校验
test/                         端到端测试
docs/                         接口与部署文档
.env.example                  可提交的环境变量模板
```

## 日志与常见问题

连接、断线和 Socket.IO 请求结果输出到控制台。成功日志包含操作名、连接 ID，适用时包含房间 ID；失败日志包含拒绝原因，不输出聊天正文、房间密码或完整请求体。当前没有通用 HTTP 请求访问日志，也没有应用内日志轮转。

`Telemetry rejected (401)`：当前启动代码未启用外部 telemetry，运行不需要 `appKey` / `appSecret`。如果仍出现该日志，请检查是否运行旧构建或其他进程，再重新构建、重启；不要为消除该日志填写虚假凭据。

“房间服务拒绝了该请求”：这是客户端的概括提示，应结合回执 `error` 和服务端 `request=... rejected=...` 日志检查参数、密码、人数上限或重复加入。

## Git 与许可证

`.gitignore` 排除依赖、构建产物、环境变量、日志、缓存和测试报告，不排除锁文件、配置模板及文档。忽略规则不会自动移除已跟踪文件；提交前用 `git status --short` 检查。

本项目 `package.json` 标记为 `private: true`、`UNLICENSED`，不应将 NestJS 框架的许可证误写为本项目许可证。
