# 隐私与安全边界

BugRewind V1 仅允许本地绑定：不会启动对公网开放的服务器。SDK 必须由真实用户调用 `start()` 后才收集。SDK 默认遮盖所有文本，仅带有 `data-replay-safe` 属性的测试应用内容可以解锁部分非敏感文字。`input/textarea/select/form/script/iframe/img/style` 等元素直接剔除。所有属性白名单化，禁用外链、事件属性；Dashboard 使用 sandbox 且关闭脚本的 iframe 渲染结构快照。

采集不包含 Cookie、Header、Authorization、网络请求体、响应体、Query 参数或完整第三方 URL。错误 message 和 stack 仍可能含意外敏感信息；已使用基本正则脱敏但无法保证 100% 覆盖。不可未经安全审查直接嵌入真实生产网站。服务器对读取数据使用 admin token；项目 public key 不是秘密。

每个会话可在界面删除数据库记录与对应 gzip 块，7 天过期回收。项目未来如需公网化，必须首先补齐：授权和同意管理、端到端审计、认证/授权/速率限制、跨租户隔离、PⅡ 管理、加密与复杂泄露扫描。对任何第三方网站的采集都需要合法授权。
