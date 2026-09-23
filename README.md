# 2FA 二步验证与全设备云端同步系统

> **融合之作**：汲取 **2fa.cash** 的极致极简交互与现代 UI 审美，结合 **wuzf/2fa** 的账户隔离、数据加密与 **Cloudflare Workers 全球云端部署** 架构。

![Platform](https://img.shields.io/badge/Platform-Cloudflare%20Workers%20%7C%20Node.js%20%7C%20Docker-orange)
![Security](https://img.shields.io/badge/Security-PBKDF2--SHA256%20%2B%20Web%20Crypto-success)
![RFC 6238](https://img.shields.io/badge/RFC-6238%20TOTP-blue)
![Zero Dependency](https://img.shields.io/badge/Dependencies-Zero-brightgreen)

---

## 🌟 核心特性一览

1. **两套体系深度融合**：
   - **2fa.cash 式体验**：首页保留免登录快捷取码、批量取码、大字号 6 位验证码、圆环倒计时动画、拖拽/Ctrl+V 截图直接识码。
   - **wuzf/2fa 级云端存储**：注册/登录专属账号后，密钥永久存储在 **Cloudflare KV** 或本地数据库，手机、平板、电脑随时随地无缝同步。
2. **多端秒级同步**：
   - 在电脑端扫码添加密钥，手机打开网页登录相同账号即可实时查看并复制动态验证码。
3. **下一轮验证码预告 (Next Code)**：
   - 针对倒计时临近（最后 5 秒）的使用痛点，提供下轮验证码预告，彻底避免输入时恰好过期的尴尬。
4. **公开 OTP URL 接口**：
   - 支持通过 `https://你的域名/otp/SECRET_KEY` 直接查看或通过 JSON API 获取实时验证码。
5. **多格式数据导入与导出**：
   - 支持 TXT（通用 `otpauth://` 格式）、JSON、CSV 批量导入与导出备份。
6. **零依赖安全架构**：
   - 密码采用 PBKDF2 加盐安全哈希，TOTP 在浏览器本地毫秒级纯纯离线计算，安全放心。

---

## ☁️ Cloudflare Workers 一键部署指南 (强烈推荐)

部署到 Cloudflare 完全**免费**、**无需购买服务器**、**自带全球 CDN 加速与 HTTPS 证书**。

### 方式一：Cloudflare 网页后台极速部署（免装任何工具，1 分钟完成）

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 在左侧菜单点击 **Workers 和 Pages** ➔ **创建 Worker**（命名为如 `my-2fa`），点击 **部署**。
3. 进入该 Worker 的详情页，点击右上角 **编辑代码**：
   - 将本项目生成的 [**`worker.js`**](file:///home/dark/2fa/worker.js) 中的所有代码**全部复制并粘贴**到编辑器中。
   - 点击 **保存并部署**。
4. **绑定 KV 云端数据库（用于保存账号数据）**：
   - 在左侧菜单 **Workers 和 Pages** ➔ **KV** ➔ **创建命名空间**（名称输入 `2fa_db`）。
   - 回到刚才创建的 Worker ➔ **设置 (Settings)** ➔ **变量与机密 (Variables)** ➔ **KV 命名空间绑定 (KV Namespace Bindings)**：
     - 变量名称：`SECRETS_KV`
     - KV 命名空间：选择刚才创建的 `2fa_db`
   - 点击 **保存并部署**。
5. **部署完成**！打开 Cloudflare 为你生成的 `https://my-2fa.xxx.workers.dev` 链接，即可在任何手机、电脑浏览器上注册登录使用！

---

### 方式二：使用 Wrangler CLI 命令行部署

如果你本地已有 Node.js 环境：

```bash
cd /home/dark/2fa

# 1. 登录 Cloudflare
npx wrangler login

# 2. 创建 KV 命名空间
npx wrangler kv:namespace create SECRETS_KV

# 3. 部署上线
npm run deploy
```

---

## 💻 本地或私有服务器运行

如果你也希望在内网 NAS、本地开发机或独立 VPS 上运行：

### 1. 本地 Node.js 启动
```bash
cd /home/dark/2fa
npm start
```
访问：`http://localhost:3000`（数据保存在本地 `data/db.json`，同样支持多用户登录与隔离）。

### 2. Docker / Docker Compose 部署
```bash
cd /home/dark/2fa
docker-compose up -d
```
访问：`http://your-server-ip:8080`

---

## 📁 项目关键文件

- **`worker.js`**：独立完整的 Cloudflare Worker 脚本（静态前端 + API + KV 驱动一体化）。
- **`wrangler.toml`**：Cloudflare Workers 部署配置文件。
- **`build-worker.js`**：一键打包生成最新 `worker.js` 的构建脚本。
- **`index.html`** / **`style.css`** / **`app.js`**：现代化响应式前端源码。
- **`server.js`** / **`db.js`**：本地 Node.js 运行时与文件数据库。
