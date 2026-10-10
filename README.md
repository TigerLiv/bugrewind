# BugRewind — 故障时光机

> **Replay the Bug. Understand the Cause.** 一个可运行的、隐私优先的浏览器故障回放与证据诊断工作台。

BugRewind 帮助你把「用户刚才点击保存，然后页面出错」变成可核查的技术事件：浏览器 SDK 在获得明确同意后收集脱敏结构快照、交互、错误和网络响应元信息；工作台将它们对齐为可点击的时间轴，关联异常分组，并生成引用实际事件 ID 的诊断假设和受控复现草稿。

## 功能一览（已实现）

| 功能 | 说明 |
| --- | --- |
| 浏览器 SDK | 同意后启动采集；DOM 安全结构快照、点击、滚动、路由、JS exception、unhandled rejection、fetch 状态与耗时；批量上传与去重 |
| 故障实验室 | 内置模拟 HTTP 500、JS TypeError 和 HTTP 200 的可交互 Demo App |
| 故障工作台 | 私有令牌入口、会话列表、问题列表、统计总览、会话删除 |
| Session Replay | 按时间轴跳转与播放已脱敏 DOM 结构快照，联动查看每个事件证据 |
| Error Intelligence | 错误规范化指纹聚合；展示出现次数、关联会话及事件 |
| Rules Diagnosis | 不依赖模型的可追溯诊断假设，引用真实事件 ID 并列出验证建议 |
| AI Diagnosis | 可选 OpenAI-compatible Chat Completions 模型，有限事件证据包与输出引用校验；没有密钥时明确失败 |
| Reproduction Lab | 生成仅针对内置 Demo 的 Playwright 测试草稿；受控 HTTP 合约验证（非浏览器完整复现） |
| 安全与隐私 | 文本及输入默认遮盖、网络请求体不采集、同源检查、控制台 Bearer 访问令牌、7 天清理、按会话删除 |
| 自动化 | Node 集成测试、静态隐私检查、GitHub Actions CI |

## 立即运行（零外部依赖）

需要 **Node.js 22.13+**（推荐 Node 24，内置 `node:sqlite`）。不需要 Docker、PostgreSQL、Redis 或 API Key。

```bash
npm start
# 工作台 http://127.0.0.1:4177
# Demo    http://127.0.0.1:4177/demo
```

第一次启动时，终端会显示 `Console access token`。将令牌粘贴到工作台登录框。令牌保存在 `data/admin-token.txt`（不提交到 Git）。也可以通过 `ADMIN_TOKEN` 环境变量显式设置。所有数据都在 `data/`，只监听本机地址。

建议按顺序体验：

1. 打开 `/demo`，点击「同意并开始采集」。
2. 点击「模拟保存失败 (HTTP 500)」和「模拟 JavaScript 异常」。
3. 回到工作台，点击刷新；打开「会话回放」，播放 DOM 结构快照并点击网络/异常事件。
4. 打开「异常中心」，点击问题，运行「规则诊断」，检查每个 `event:ID` 引用。
5. 点击「生成复现测试草稿」，然后「验证内置 Demo API」，查看验证方法与局限性。
6. 可以在 Node 服务端配置真实 LLM 密钥，使用「调用 AI 模型」。

## 真实 AI 模式（可选）

```bash
LLM_API_KEY=你的密钥 \
LLM_MODEL=支持 Chat Completions 的模型 \
LLM_BASE_URL=https://api.openai.com/v1 \
npm start
```

密钥从不发送到浏览器。诊断仅发送脱敏后的异常、事件类型、时间与少量事件说明；**不发送原始 DOM 快照、表单值、网络报文、Cookie 或授权头**。模型输出需要通过结构与 `evidenceIds` 存在性验证。得到的是辅助诊断假设，**不是已证明的根因**。

## 技术架构

- **浏览器**：安装即用的 ES Modules SDK 与无构建步骤的可视化工作台（现代原生 JS + CSS），演示场景自带；这是刻意选择的 *zero-dependency runnable edition*，不是 Vue3 版本。
- **API**：Node.js HTTP 服务，限制 Origin/Host/Body Size，admin Bearer 验证，结构化 JSON API。
- **持久化**：Node 内置 SQLite（WAL 模式、唯一序列去重、问题聚合），回放结构块使用本地 gzip 文件存储。
- **智能诊断**：规则模式 + 可选服务端 LLM，证据集合白名单验证。
- **复现实验室**：生成 Playwright 脚本草稿，内置 Demo HTTP Contract 验证；不会运行任意来源的测试脚本。

`src/` 为后端模块；`public/` 包含 UI、SDK、Demo；`tests/` 包含真实接口集成测试；`docs/` 包含架构与安全边界。

## 为什么不是完整生产版？

这是功能闭环真实可运行的 **本地单用户 V1**，刻意不宣称不存在的功能：

- **结构回放不是 rrweb 像素级会话回放**：只记录受控、脱敏后的 DOM 结构关键帧，无法还原 canvas、样式细节、输入内容与任意第三方页面；没有真实视频录制。
- **不是多租户 SaaS**：没有组织 RBAC、外网认证体系或第三方网站 SDK 发布；不要通过公网反向代理直接暴露。
- **没有部署数据库集群**：为了零依赖使用本地 SQLite + gzip，而非原规划的 PostgreSQL/MinIO/Redis；可在未来按规模迁移。
- **Playwright 目前输出草稿**：本地 API 验证不能冒充完整浏览器 UI 自动化执行。完整 Playwright 自动化运行器需在隔离环境和显式授权下接入。
- **API Key 非私密访问密钥**：`demo-public-key` 仅用于指示本地采集项目；任何远程生产使用都需要单独实现租户鉴权、速率限制、存储加密、同意管理和审计。

## 测试

```bash
npm test
npm run smoke
```

GitHub Actions 运行 Node 测试；没有网络下载或托管服务要求。Node 22 下 `node:sqlite` 可能显示实验性警告，这不影响本地运行。

## 隐私设计

见 [docs/privacy.md](docs/privacy.md)。默认只有用户点击同意后才采集。SDK 会排除表单和媒体、屏蔽非白名单文本、不采集 request/response body；使用 sandbox iframe 播放结构快照；服务仅监听 loopback，支持单会话删除与过期清理。

## 项目路线图（尚未实现）

可选的下一阶段：Vue3 + Vite 面板重构、rrweb 的完整安全集成与精细屏蔽、PostgreSQL + MinIO、Redis/BullMQ 多任务处理、Playwright 隔离执行器、多租户 RBAC、ReviewPilot 版本证据联动、SDK npm 发布与生产容量测试。不要将这些当作 V1 已完成特性。
