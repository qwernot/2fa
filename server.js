const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

// 核心 TOTP 算法 (用于服务端 /otp/ 路由)
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32ToBytes(base32) {
  const cleaned = base32.replace(/=+$/, '').toUpperCase().replace(/[\s-]/g, '');
  let bits = '';
  for (let i = 0; i < cleaned.length; i++) {
    const val = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (val === -1) throw new Error(`Invalid Base32 character: ${cleaned[i]}`);
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.substring(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

function calculateTOTP(secret, { period = 30, digits = 6, algorithm = 'SHA-1', timestamp = Date.now() } = {}) {
  const keyBytes = base32ToBytes(secret);
  let algo = algorithm.toUpperCase();
  if (algo === 'SHA1' || algo === 'SHA-1') algo = 'sha1';
  else if (algo === 'SHA256' || algo === 'SHA-256') algo = 'sha256';
  else if (algo === 'SHA512' || algo === 'SHA-512') algo = 'sha512';
  else algo = 'sha1';

  const epoch = Math.floor(timestamp / 1000);
  const counter = Math.floor(epoch / period);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac(algo, Buffer.from(keyBytes)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binary % (10 ** digits)).toString().padStart(digits, '0');
}

// 解析 JSON Body
function parseJSONBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload Too Large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON format'));
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

function getAuthUser(req) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    return db.getUserByToken(token);
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // ==========================================
  // 参考 wuzf/2fa 的公开 OTP 路由 (/otp/:secret)
  // ==========================================
  if (pathname.startsWith('/otp/')) {
    const secretKey = pathname.replace('/otp/', '').trim();
    const period = parseInt(parsedUrl.searchParams.get('period') || '30', 10);
    const digits = parseInt(parsedUrl.searchParams.get('digits') || '6', 10);
    const algorithm = (parsedUrl.searchParams.get('algorithm') || 'SHA-1').toUpperCase();
    const format = parsedUrl.searchParams.get('format') || '';
    const wantsJson = format === 'json' || (req.headers['accept'] && req.headers['accept'].includes('application/json'));

    try {
      const now = Date.now();
      const code = calculateTOTP(secretKey, { period, digits, algorithm, timestamp: now });
      const nextCode = calculateTOTP(secretKey, { period, digits, algorithm, timestamp: now + period * 1000 });
      const remaining = period - (Math.floor(now / 1000) % period);

      if (wantsJson) {
        return sendJSON(res, 200, {
          code,
          nextCode,
          remaining,
          period,
          digits,
          algorithm
        });
      }

      // 返回简洁优雅的在线 OTP 查看页面
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Cosmo 2FA 实时验证码 - ${code}</title>
          <style>
            body { font-family: -apple-system, system-ui, sans-serif; background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
            .card { background: #121215; border: 1px solid #27272a; padding: 2.5rem; border-radius: 16px; text-align: center; max-width: 360px; width: 90%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            .code { font-family: ui-monospace, monospace; font-size: 3rem; font-weight: bold; letter-spacing: 0.15em; margin: 1rem 0; color: #fff; cursor: pointer; }
            .next { color: #71717a; font-size: 0.9rem; margin-top: 1rem; }
            .badge { display: inline-block; background: #27272a; padding: 0.3rem 0.8rem; border-radius: 9999px; font-size: 0.8rem; }
            .timer { font-size: 1.1rem; font-weight: bold; margin-top: 0.5rem; color: #10b981; }
          </style>
        </head>
        <body>
          <div class="card">
            <span class="badge">OTP 实时验证码</span>
            <div class="code" onclick="navigator.clipboard.writeText('${code}'); alert('已复制验证码: ${code}')">${code.slice(0, 3)} ${code.slice(3)}</div>
            <div class="timer">剩余 ${remaining} 秒</div>
            <div class="next">下一轮验证码：<strong>${nextCode}</strong></div>
          </div>
          <script>setTimeout(() => location.reload(), ${remaining * 1000 + 500});</script>
        </body>
        </html>
      `);
      return;
    } catch (err) {
      if (wantsJson) {
        return sendJSON(res, 400, { error: err.message });
      }
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('无效的 2FA 密钥: ' + err.message);
    }
  }

  // ==========================================
  // API 路由
  // ==========================================
  if (pathname.startsWith('/api/')) {
    try {
      // 1. 注册
      if (pathname === '/api/register' && req.method === 'POST') {
        const { username, password } = await parseJSONBody(req);
        if (!username || username.trim().length < 3) {
          return sendJSON(res, 400, { error: '用户名至少需要 3 个字符' });
        }
        if (!password || password.length < 6) {
          return sendJSON(res, 400, { error: '密码长度至少需要 6 位' });
        }
        try {
          const user = db.createUser(username, password);
          const token = db.createSession(user.id);
          return sendJSON(res, 200, { user, token, message: '注册成功' });
        } catch (err) {
          return sendJSON(res, 400, { error: err.message });
        }
      }

      // 2. 登录
      if (pathname === '/api/login' && req.method === 'POST') {
        const { username, password } = await parseJSONBody(req);
        if (!username || !password) {
          return sendJSON(res, 400, { error: '请输入用户名和密码' });
        }
        const user = db.findUserByUsername(username);
        if (!user || !db.verifyPassword(password, user.passwordHash, user.salt)) {
          return sendJSON(res, 401, { error: '用户名或密码不正确' });
        }
        const token = db.createSession(user.id);
        return sendJSON(res, 200, {
          user: { id: user.id, username: user.username },
          token,
          message: '登录成功'
        });
      }

      // 3. 当前登录用户信息
      if (pathname === '/api/me' && req.method === 'GET') {
        const user = getAuthUser(req);
        if (!user) return sendJSON(res, 401, { error: '未登录或登录已过期' });
        return sendJSON(res, 200, { user });
      }

      // 4. 退出登录
      if (pathname === '/api/logout' && req.method === 'POST') {
        const authHeader = req.headers['authorization'] || '';
        if (authHeader.startsWith('Bearer ')) {
          db.deleteSession(authHeader.substring(7).trim());
        }
        return sendJSON(res, 200, { message: '已退出登录' });
      }

      // 鉴权拦截
      const currentUser = getAuthUser(req);
      if (!currentUser) {
        return sendJSON(res, 401, { error: '请先登录以访问您的 2FA 账号库' });
      }

      // 5. 获取账号列表
      if (pathname === '/api/accounts' && req.method === 'GET') {
        const accounts = db.getAccountsByUserId(currentUser.id);
        return sendJSON(res, 200, { accounts });
      }

      // 6. 添加账号
      if (pathname === '/api/accounts' && req.method === 'POST') {
        const data = await parseJSONBody(req);
        if (!data.name || !data.secret) {
          return sendJSON(res, 400, { error: '账号名称和密钥为必填项' });
        }
        const acc = db.addAccount(currentUser.id, data);
        return sendJSON(res, 200, { account: acc, message: '添加成功' });
      }

      // 7. 批量导入账号
      if (pathname === '/api/accounts/batch-import' && req.method === 'POST') {
        const { accounts } = await parseJSONBody(req);
        if (!Array.isArray(accounts)) {
          return sendJSON(res, 400, { error: '数据格式错误，需为账号数组' });
        }
        const imported = db.batchImportAccounts(currentUser.id, accounts);
        return sendJSON(res, 200, { count: imported, message: `成功导入 ${imported} 个账号` });
      }

      // 8. 更新账号
      if (pathname.startsWith('/api/accounts/') && req.method === 'PUT') {
        const accountId = pathname.replace('/api/accounts/', '').trim();
        const data = await parseJSONBody(req);
        const updated = db.updateAccount(currentUser.id, accountId, data);
        return sendJSON(res, 200, { account: updated, message: '更新成功' });
      }

      // 9. 删除账号
      if (pathname.startsWith('/api/accounts/') && req.method === 'DELETE') {
        const accountId = pathname.replace('/api/accounts/', '').trim();
        const deleted = db.deleteAccount(currentUser.id, accountId);
        if (!deleted) return sendJSON(res, 404, { error: '账号不存在' });
        return sendJSON(res, 200, { message: '删除成功' });
      }

      return sendJSON(res, 404, { error: 'API endpoint not found' });
    } catch (err) {
      console.error('API Error:', err);
      return sendJSON(res, 500, { error: err.message || 'Server Internal Error' });
    }
  }

  // ==========================================
  // 静态文件服务
  // ==========================================
  let reqPath = decodeURIComponent(pathname);
  if (reqPath === '/' || reqPath === '' || reqPath === '/my-2fa') {
    reqPath = '/index.html';
  }

  const filePath = path.join(__dirname, reqPath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = path.join(__dirname, 'index.html');
      fs.readFile(indexPath, (err2, data) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

function startServer(port) {
  server.listen(port, HOST, () => {
    console.log('\n========================================');
    console.log('  🚀 Cosmo 2FA 服务已就绪！(支持登录保存 + 公开 OTP 路由)');
    console.log(`  ➜ 本地访问:   http://localhost:${port}/`);
    console.log(`  ➜ 局域网访问: http://127.0.0.1:${port}/`);
    console.log('  🔒 提示: 纯前端计算 + 服务端安全用户隔离');
    console.log('========================================\n');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`端口 ${port} 已被占用，正在尝试 ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('服务启动失败:', err);
    }
  });
}

startServer(PORT);
