const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

const workerCode = `/**
 * 2FA 聚合版 - Cloudflare Worker 独立部署单文件
 * 融合 2fa.cash 极致现代 UI + wuzf/2fa 账号系统与 Cloudflare KV 云端同步
 * 
 * 部署方式：
 * 1. 在 Cloudflare Workers 后台创建 Worker，复制本文件全部代码粘贴保存
 * 2. 绑定 KV 命名空间: SECRETS_KV
 * 3. 部署后即可在手机、电脑、任何设备随时登录访问与管理！
 */

// 内嵌静态资源
const HTML_CONTENT = ${JSON.stringify(html)};
const CSS_CONTENT = ${JSON.stringify(css)};
const JS_CONTENT = ${JSON.stringify(js)};

// 辅助：Base32 解码
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32ToBytes(base32) {
  const cleaned = base32.replace(/=+$/, '').toUpperCase().replace(/[\\s-]/g, '');
  let bits = '';
  for (let i = 0; i < cleaned.length; i++) {
    const val = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (val === -1) throw new Error(\`Invalid Base32 character: \${cleaned[i]}\`);
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.substring(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

// 辅助：TOTP 计算 (Web Crypto)
async function calculateTOTP(secret, { period = 30, digits = 6, algorithm = 'SHA-1', timestamp = Date.now() } = {}) {
  const keyBytes = base32ToBytes(secret);
  let hashAlgo = algorithm.toUpperCase();
  if (hashAlgo === 'SHA1') hashAlgo = 'SHA-1';
  if (hashAlgo === 'SHA256') hashAlgo = 'SHA-256';
  if (hashAlgo === 'SHA512') hashAlgo = 'SHA-512';

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: { name: hashAlgo } },
    false,
    ['sign']
  );

  const epoch = Math.floor(timestamp / 1000);
  const counter = Math.floor(epoch / period);

  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(counter), false);

  const signature = await crypto.subtle.sign('HMAC', key, buffer);
  const hmac = new Uint8Array(signature);

  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binary % (10 ** digits)).toString().padStart(digits, '0');
}

// 辅助：PBKDF2 密码哈希
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function hashPassword(password, saltHex = null) {
  const enc = new TextEncoder();
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  const derivedKey = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  return {
    hash: bytesToHex(new Uint8Array(derivedKey)),
    salt: bytesToHex(salt)
  };
}

function sendJSON(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }
  });
}

// 内存 Mock KV 缓存（防止用户忘记绑定 KV 时直接报错崩溃）
const memoryKV = new Map();
function getKV(env) {
  if (env && env.SECRETS_KV) {
    return env.SECRETS_KV;
  }
  return {
    async get(k, type) {
      const v = memoryKV.get(k);
      if (!v) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) {
      memoryKV.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    },
    async delete(k) {
      memoryKV.delete(k);
    }
  };
}

// 提取当前用户
async function getAuthUser(request, kv) {
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    const session = await kv.get(\`session:\${token}\`, 'json');
    if (session && session.userId && session.expiresAt > Date.now()) {
      return await kv.get(\`user_id:\${session.userId}\`, 'json');
    }
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;
    const kv = getKV(env);

    // ==========================================
    // 公开 OTP 路由 (/otp/:secret)
    // ==========================================
    if (pathname.startsWith('/otp/')) {
      const secret = pathname.replace('/otp/', '').trim();
      const period = parseInt(url.searchParams.get('period') || '30', 10);
      const digits = parseInt(url.searchParams.get('digits') || '6', 10);
      const algorithm = (url.searchParams.get('algorithm') || 'SHA-1').toUpperCase();
      const wantsJson = url.searchParams.get('format') === 'json' ||
        (request.headers.get('accept') && request.headers.get('accept').includes('application/json'));

      try {
        const now = Date.now();
        const code = await calculateTOTP(secret, { period, digits, algorithm, timestamp: now });
        const nextCode = await calculateTOTP(secret, { period, digits, algorithm, timestamp: now + period * 1000 });
        const remaining = period - (Math.floor(now / 1000) % period);

        if (wantsJson) {
          return sendJSON({ code, nextCode, remaining, period, digits, algorithm });
        }

        const htmlResp = \`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>2FA OTP 实时验证码 - \${code}</title>
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
              <span class="badge">Cloudflare Workers 实时验证码</span>
              <div class="code" onclick="navigator.clipboard.writeText('\${code}'); alert('已复制验证码: \${code}')">\${code.slice(0, 3)} \${code.slice(3)}</div>
              <div class="timer">剩余 \${remaining} 秒</div>
              <div class="next">下一轮验证码：<strong>\${nextCode}</strong></div>
            </div>
            <script>setTimeout(() => location.reload(), \${remaining * 1000 + 500});</script>
          </body>
          </html>
        \`;
        return new Response(htmlResp, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      } catch (err) {
        return sendJSON({ error: err.message }, 400);
      }
    }

    // ==========================================
    // API 路由 (Cloudflare KV 持久化)
    // ==========================================
    if (pathname.startsWith('/api/')) {
      try {
        // 1. 注册
        if (pathname === '/api/register' && request.method === 'POST') {
          const { username, password } = await request.json().catch(() => ({}));
          if (!username || username.trim().length < 3) {
            return sendJSON({ error: '用户名至少需要 3 个字符' }, 400);
          }
          if (!password || password.length < 6) {
            return sendJSON({ error: '密码长度至少需要 6 位' }, 400);
          }
          const cleanName = username.trim().toLowerCase();
          const existing = await kv.get(\`user:\${cleanName}\`, 'json');
          if (existing) {
            return sendJSON({ error: '该用户名已被注册' }, 400);
          }

          const { hash, salt } = await hashPassword(password);
          const userId = 'u_' + bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
          const user = { id: userId, username: username.trim(), passwordHash: hash, salt, createdAt: Date.now() };

          await kv.put(\`user:\${cleanName}\`, JSON.stringify(user));
          await kv.put(\`user_id:\${userId}\`, JSON.stringify({ id: user.id, username: user.username }));

          const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
          await kv.put(\`session:\${token}\`, JSON.stringify({
            userId,
            expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
          }));

          return sendJSON({ user: { id: user.id, username: user.username }, token, message: '注册成功' });
        }

        // 2. 登录
        if (pathname === '/api/login' && request.method === 'POST') {
          const { username, password } = await request.json().catch(() => ({}));
          if (!username || !password) {
            return sendJSON({ error: '请输入用户名和密码' }, 400);
          }
          const cleanName = username.trim().toLowerCase();
          const user = await kv.get(\`user:\${cleanName}\`, 'json');
          if (!user) {
            return sendJSON({ error: '用户名或密码不正确' }, 401);
          }

          const verify = await hashPassword(password, user.salt);
          if (verify.hash !== user.passwordHash) {
            return sendJSON({ error: '用户名或密码不正确' }, 401);
          }

          const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
          await kv.put(\`session:\${token}\`, JSON.stringify({
            userId: user.id,
            expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
          }));

          return sendJSON({ user: { id: user.id, username: user.username }, token, message: '登录成功' });
        }

        // 3. 用户信息
        if (pathname === '/api/me' && request.method === 'GET') {
          const user = await getAuthUser(request, kv);
          if (!user) return sendJSON({ error: '未登录或登录已过期' }, 401);
          return sendJSON({ user });
        }

        // 4. 退出登录
        if (pathname === '/api/logout' && request.method === 'POST') {
          const authHeader = request.headers.get('Authorization') || '';
          if (authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7).trim();
            await kv.delete(\`session:\${token}\`);
          }
          return sendJSON({ message: '已退出登录' });
        }

        // 登录拦截
        const user = await getAuthUser(request, kv);
        if (!user) {
          return sendJSON({ error: '请先登录以访问您的 2FA 账号库' }, 401);
        }

        // 5. 获取账号列表
        if (pathname === '/api/accounts' && request.method === 'GET') {
          const list = (await kv.get(\`accounts:\${user.id}\`, 'json')) || [];
          return sendJSON({ accounts: list });
        }

        // 6. 添加账号
        if (pathname === '/api/accounts' && request.method === 'POST') {
          const data = await request.json().catch(() => ({}));
          if (!data.name || !data.secret) {
            return sendJSON({ error: '账号名称和密钥为必填项' }, 400);
          }
          const list = (await kv.get(\`accounts:\${user.id}\`, 'json')) || [];
          const newAcc = {
            id: 'acc_' + bytesToHex(crypto.getRandomValues(new Uint8Array(8))),
            userId: user.id,
            name: data.name.trim(),
            issuer: (data.issuer || '').trim(),
            secret: data.secret.trim().replace(/[\\s-]/g, '').toUpperCase(),
            algorithm: data.algorithm || 'SHA-1',
            digits: parseInt(data.digits, 10) || 6,
            period: parseInt(data.period, 10) || 30,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          list.unshift(newAcc);
          await kv.put(\`accounts:\${user.id}\`, JSON.stringify(list));
          return sendJSON({ account: newAcc, message: '添加成功' });
        }

        // 7. 批量导入
        if (pathname === '/api/accounts/batch-import' && request.method === 'POST') {
          const { accounts } = await request.json().catch(() => ({}));
          if (!Array.isArray(accounts)) {
            return sendJSON({ error: '格式错误，需为数组' }, 400);
          }
          const list = (await kv.get(\`accounts:\${user.id}\`, 'json')) || [];
          let count = 0;
          for (const item of accounts) {
            if (!item.secret) continue;
            list.unshift({
              id: 'acc_' + bytesToHex(crypto.getRandomValues(new Uint8Array(8))),
              userId: user.id,
              name: (item.name || '导入账号').trim(),
              issuer: (item.issuer || '').trim(),
              secret: item.secret.trim().replace(/[\\s-]/g, '').toUpperCase(),
              algorithm: item.algorithm || 'SHA-1',
              digits: parseInt(item.digits, 10) || 6,
              period: parseInt(item.period, 10) || 30,
              createdAt: Date.now(),
              updatedAt: Date.now()
            });
            count++;
          }
          await kv.put(\`accounts:\${user.id}\`, JSON.stringify(list));
          return sendJSON({ count, message: \`成功导入 \${count} 个账号\` });
        }

        // 8. 更新账号
        if (pathname.startsWith('/api/accounts/') && request.method === 'PUT') {
          const accountId = pathname.replace('/api/accounts/', '').trim();
          const data = await request.json().catch(() => ({}));
          const list = (await kv.get(\`accounts:\${user.id}\`, 'json')) || [];
          const target = list.find(a => a.id === accountId);
          if (!target) return sendJSON({ error: '账号不存在' }, 404);

          if (data.name !== undefined) target.name = data.name.trim();
          if (data.issuer !== undefined) target.issuer = (data.issuer || '').trim();
          if (data.secret !== undefined) target.secret = data.secret.trim().replace(/[\\s-]/g, '').toUpperCase();
          target.updatedAt = Date.now();

          await kv.put(\`accounts:\${user.id}\`, JSON.stringify(list));
          return sendJSON({ account: target, message: '更新成功' });
        }

        // 9. 删除账号
        if (pathname.startsWith('/api/accounts/') && request.method === 'DELETE') {
          const accountId = pathname.replace('/api/accounts/', '').trim();
          let list = (await kv.get(\`accounts:\${user.id}\`, 'json')) || [];
          const initialLen = list.length;
          list = list.filter(a => a.id !== accountId);
          if (list.length === initialLen) return sendJSON({ error: '账号不存在' }, 404);

          await kv.put(\`accounts:\${user.id}\`, JSON.stringify(list));
          return sendJSON({ message: '删除成功' });
        }

        return sendJSON({ error: 'API not found' }, 404);
      } catch (err) {
        return sendJSON({ error: err.message }, 500);
      }
    }

    // ==========================================
    // 静态资源响应 (单 Worker 独立提供全站)
    // ==========================================
    if (pathname === '/style.css') {
      return new Response(CSS_CONTENT, {
        headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
      });
    }

    if (pathname === '/app.js') {
      return new Response(JS_CONTENT, {
        headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
      });
    }

    // 默认返回 HTML (支持 SPA)
    return new Response(HTML_CONTENT, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
};
`;

fs.writeFileSync(path.join(__dirname, 'worker.js'), workerCode, 'utf8');
console.log('✅ 成功构建 Cloudflare Worker 单文件独立脚本: worker.js (' + Math.round(workerCode.length / 1024) + ' KB)');
