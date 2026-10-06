# Vercel 部署与连接验证

项目使用 `vercel.json` 的 NestJS preset，以 `src/main.ts` 为函数入口。
入口初始化 REST 和 Socket.IO，调用非阻塞 `listen()` 供运行时捕获原始 HTTP server。
不要在模块顶层等待 `app.listen()`，也不要用仅处理 REST 的 Express handler 替换 server。

## 必需的部署文件

Nest 的网关模块包含动态加载。2026-10-07 的运行日志确认部署包缺少
`node_modules/@nestjs/websockets/socket-module.js`，导致启动时 `ERR_MODULE_NOT_FOUND`。
因此 `functions["src/main.ts"].includeFiles` 显式包含整个 WebSocket package，
同时匹配普通 node_modules 路径与 pnpm 的 `.pnpm` 实际存储路径。
静态导入和本地启动成功不能单独证明云端部署包完整。

配置依据：[Vercel includeFiles](https://vercel.com/docs/project-configuration/vercel-json)。

## 验证

本地运行 `pnpm run build`、`pnpm run lint`、`pnpm test` 和 `pnpm run test:e2e`。
入口回归测试覆盖文件包含模式、Vercel listen 捕获、HTTP `/test`、直接 WebSocket
连接及 Socket.IO ack。

本次还使用临时工具 `@vercel/nft` 1.11.0 对 `dist/main.js` 追踪，叠加 includeFiles，
把文件与 pnpm 链接复制到隔离目录后启动：HTTP、WebSocket 与 ack 均通过。
工具没有加入项目依赖。这是本地隔离包验证，不能替代 Vercel 真实部署验证。

重新部署包含最新 `vercel.json` 的提交后，先验证 `/test` 返回 200，再验证
`/socket.io/?EIO=4&transport=websocket` 握手成功及 `/bangocat` namespace 连接。
客户端直接使用 WebSocket transport；浏览器健康检查只验证 HTTP。

仍需验证多客户端房间一致性与断线恢复。房间目前位于进程内存，Vercel 不保证不同
连接进入同一实例，连接也受函数最大运行时间限制；见
[Vercel WebSocket 文档](https://vercel.com/docs/functions/websockets)。
