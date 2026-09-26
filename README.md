# Cosmo 2FA - 现代化在线二步验证与跨设备云端管理系统

> **Cosmo 2FA** 是一款轻量、现代、安全的 2FA / TOTP 动态验证码生成与跨设备同步管理工具。支持免登录即开即用、多设备账号云端安全同步，并支持一键部署到 **Cloudflare Workers** 全球边缘网络。

![Platform](https://img.shields.io/badge/Platform-Cloudflare%20Workers%20%7C%20Node.js%20%7C%20Docker-orange)
![Security](https://img.shields.io/badge/Security-PBKDF2--SHA256%20%2B%20Web%20Crypto-success)
![RFC 6238](https://img.shields.io/badge/RFC-6238%20TOTP-blue)
![Zero Dependency](https://img.shields.io/badge/Dependencies-Zero-brightgreen)

---

## 🌟 核心特性

1. **即开即用与云端同步双模架构**：
   - **快捷取码**：临时需要取码时无需登录，粘贴密钥即可出码，支持二维码拖拽、图片导入及 **Ctrl+V 截图直接粘贴识码**。
   - **我的 2FA 账号库**：登录你的专属账号后，密钥安全存储在 **Cloudflare KV** 或本地数据库，手机、平板、电脑多端实时同步。
   - **批量取码**：多账号矩阵支持，一行一个密钥，一键获取并复制所有最新动态验证码。
2. **下一轮验证码预告 (Next Code)**：
   - 告别倒计时最后 5 秒输入验证码时刚好过期的尴尬，实时显示并可一键复制下轮最新验证码。
3. **公开 OTP URL 接口**：
   - 支持通过 `https://你的域名/otp/SECRET_KEY` 直接在浏览器或脚本/快捷指令中读取当前验证码（支持网页与 JSON 格式）。
4. **多格式数据导入与导出**：
   - 支持标准 TXT（通用 `otpauth://` 格式）、JSON、CSV 批量导入与导出备份。
5. **极致现代 UI 与深浅色主题**：
   - 采用精致高颜值的现代卡片风格设计，自适应系统暗黑/浅色模式，全响应式适配移动端。

---

## ☁️ Cloudflare Workers 一键部署指南 (完全免费)

部署到 Cloudflare 完全**免费**、**无需购买服务器**、**自带全球 CDN 加速与 HTTPS 证书**。

### 方式一：Cloudflare 网页控制台极速部署（无需安装工具，1 分钟搞定）

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 点击 **Workers 和 Pages** ➔ **创建 Worker**（名称填写 `cosmo-2fa`），点击 **部署**。
3. 进入该 Worker 详情，点击右上角 **编辑代码**：
   - 将本项目生成的 [**`worker.js`**](file:///home/dark/2fa/worker.js) 中的所有代码**全部复制并粘贴**到编辑器中。
   - 点击 **保存并部署**。
4. **绑定 KV 云端数据库（用于跨设备永久同步）**：
   - 在 Cloudflare 控制台左侧点击 **Workers 和 Pages** ➔ **KV** ➔ **创建命名空间**（名称输入 `cosmo_2fa_db`）。
   - 回到刚才创建的 Worker ➔ **设置 (Settings)** ➔ **变量与机密 (Variables)** ➔ **KV 命名空间绑定 (KV Namespace Bindings)**：
     - **变量名称**：`SECRETS_KV`（全大写）
     - **KV 命名空间**：选择刚才创建的 `cosmo_2fa_db`
   - 点击 **保存并部署**。
5. **部署完成**！打开 Cloudflare 分配给你的专属域名（如 `https://cosmo-2fa.xxx.workers.dev`），即可在手机、电脑等任何设备上登录使用了！

---

### 方式二：使用 Wrangler CLI 命令行部署

```bash
cd /home/dark/2fa

# 1. 登录 Cloudflare
npx wrangler login

# 2. 创建 KV 命名空间
npx wrangler kv:namespace create SECRETS_KV

# 3. 构建并一键部署
npm run deploy
```

---

## 💻 本地或私有服务器运行

### 1. 本地 Node.js 启动
```bash
cd /home/dark/2fa
npm start
```
访问：`http://localhost:3000`（数据保存在本地 `data/db.json`，同样支持多用户注册登录与数据隔离）。

### 2. Docker 一键运行 (多架构支持 amd64 / arm64)

镜像已推送至 Docker Hub，支持 x86_64 及 ARM64（苹果 Mac M系列/树莓派/ARM云服务器等）：

```bash
# 方式一：直接运行 Docker 镜像
docker run -d \
  --name cosmo-2fa \
  --restart unless-stopped \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  darkver8/cosmo-2fa:latest

# 方式二：使用 docker-compose 一键启动
docker-compose up -d
```
访问：`http://your-server-ip:3000` (数据将自动持久化保存在挂载的 `./data` 目录中)。

---

## 📁 项目关键文件

- **`worker.js`**：独立完整的 Cloudflare Worker 脚本（前端静态资源 + API + KV 驱动一体化单文件）。
- **`wrangler.toml`**：Cloudflare Workers 部署配置文件。
- **`build-worker.js`**：自动打包构建最新 `worker.js` 的脚本。
- **`index.html`** / **`style.css`** / **`app.js`**：Cosmo 2FA 响应式前端源码。
- **`server.js`** / **`db.js`**：本地 Node.js 静态文件服务与轻量数据库。
