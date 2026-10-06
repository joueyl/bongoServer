# Vercel 部署与连接验证

项目使用 `vercel.json` 显式声明 `@vercel/node` 构建器，以 `src/main.ts` 为函数入口。
`vercel-build` 复用 `pnpm run build`，所有请求路由到同一 server。
入口初始化 REST 和 Socket.IO，调用非阻塞 `listen()` 供运行时捕获原始 HTTP server。
不要在模块顶层等待 `app.listen()`，也不要用仅处理 REST 的 Express handler 替换 server。

## 必需的部署文件

Nest 的网关模块包含动态加载。2026-10-07 的运行日志确认部署包缺少
`node_modules/@nestjs/websockets/socket-module.js`，导致启动时 `ERR_MODULE_NOT_FOUND`。
因此 `builds[0].config.includeFiles` 显式包含整个 WebSocket package，
项目固定使用 `pnpm@9.15.9`，通过 `.npmrc` 的 `node-linker=hoisted`
生成真实的依赖目录。包含规则只匹配该目录，不再同时打包 pnpm 链接路径
和 `.pnpm` 目标路径，避免函数包存在符号链接目录与其下文件的冲突。
静态导入和本地启动成功不能单独证明云端部署包完整。

Vercel CLI 62.1.0 已拒绝 `functions["src/main.ts"]`，因为该配置只匹配 `api` 下的函数。
这里使用文档仍支持的显式 `builds`，不再混用 `functions` 或 framework preset。
它属于 legacy 配置；若未来迁移到 `api` 函数入口，应同时迁移路由、包含规则与回归测试。
构建器精确固定到 Vercel CLI 62.1.0 自身使用的 `@vercel/node@17.0.0`，
其 peer dependency `@vercel/build-utils@14.14.0` 与该 CLI 一致。
`@vercel/node@21.0.0` 要求 14.18.0，会在该 CLI 的构建器安装阶段触发 `ERESOLVE`。
版本已通过 npm registry 核对；构建器未加入应用运行依赖，不用 `--force`
或 `--legacy-peer-deps` 绕过冲突。升级时需一起核对 CLI 与构建器的依赖版本。
配置依据：[Vercel builds](https://vercel.com/docs/project-configuration/vercel-json#builds)。

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
