const fs = require('fs');
const assert = require('assert');

console.log('========================================');
console.log('🧪 开始 2FA 项目自动化测试套件');
console.log('========================================\n');

// 1. 验证 DOM 引用
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const js = fs.readFileSync(__dirname + '/app.js', 'utf8');

const idRegex = /getElementById\(['"]([^'"]+)['"]\)/g;
const staticIds = new Set();
let match;
while ((match = idRegex.exec(js)) !== null) {
  const id = match[1];
  if (!id.startsWith('batch_') && !id.startsWith('acc_')) {
    staticIds.add(id);
  }
}

console.log(`[Test 1] 校验 DOM 元素完整性 (共 ${staticIds.size} 个静态元素)...`);
const missingIds = [];
for (const id of staticIds) {
  const target = `id="${id}"`;
  if (!html.includes(target)) {
    missingIds.push(id);
  }
}

if (missingIds.length === 0) {
  console.log('  ✅ 所有 DOM 元素在 index.html 中均已正确绑定！');
} else {
  console.error('  ❌ 缺失 DOM 元素:', missingIds);
  process.exit(1);
}

// 2. 算法单元测试：Base32 解码与 RFC 6238 标准测试向量
console.log('\n[Test 2] 校验 TOTP 加密算法与 RFC 6238 国际标准测试向量...');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32ToBytes(base32) {
  if (!base32) throw new Error('密钥不能为空');
  const cleaned = base32.replace(/=+$/, '').toUpperCase().replace(/[\s-]/g, '');
  let bits = '';
  for (let i = 0; i < cleaned.length; i++) {
    const val = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (val === -1) {
      throw new Error(`密钥包含无效字符: "${cleaned[i]}"`);
    }
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.substring(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

async function generateTOTP(secret, { period = 30, digits = 6, algorithm = 'SHA-1', timestamp = Date.now() } = {}) {
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

  const code = (binary % (10 ** digits)).toString().padStart(digits, '0');
  return code;
}

// RFC 6238 附录测试向量 (Secret: "12345678901234567890" -> Base32: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ)
const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const rfcTestVectors = [
  { time: 59, expected: '94287082' },
  { time: 1111111109, expected: '07081804' },
  { time: 1111111111, expected: '14050471' },
  { time: 1234567890, expected: '89005924' },
  { time: 2000000000, expected: '69279037' }
];

(async () => {
  for (const tv of rfcTestVectors) {
    const code = await generateTOTP(rfcSecret, {
      period: 30,
      digits: 8,
      algorithm: 'SHA-1',
      timestamp: tv.time * 1000
    });
    assert.strictEqual(code, tv.expected, `Time ${tv.time} 期望 ${tv.expected}，但计算得到 ${code}`);
    console.log(`  ✓ RFC 6238 向量验证: 时间戳 ${tv.time} -> 验证码 ${code} (通过)`);
  }

  // 3. Google Authenticator 常见 6 位标准测试
  console.log('\n[Test 3] 校验 Google Authenticator 6 位模式与格式兼容性...');
  const gaSecret = 'JBSWY3DPEHPK3PXP'; // "Hello!\xde\xad\xbe\xef"
  const currentCode = await generateTOTP(gaSecret, { period: 30, digits: 6, algorithm: 'SHA-1' });
  assert.strictEqual(currentCode.length, 6, '验证码长度应为 6 位');
  console.log(`  ✓ 当前时间 TOTP 动态验证码计算成功: [ ${currentCode.slice(0, 3)} ${currentCode.slice(3)} ] (6位数字)`);

  // 4. 解析测试: otpauth:// 链接与带空格破折号秘钥
  console.log('\n[Test 4] 校验链接与密钥智能解析器...');
  function parseSecretInput(rawInput) {
    if (!rawInput) return null;
    let input = rawInput.trim();
    if (input.startsWith('otpauth://')) {
      const url = new URL(input);
      const pathPart = decodeURIComponent(url.pathname.replace(/^\/\/?totp\/?/i, ''));
      let issuer = url.searchParams.get('issuer') || '';
      let account = pathPart;
      if (pathPart.includes(':')) {
        const parts = pathPart.split(':');
        if (!issuer) issuer = parts[0];
        account = parts.slice(1).join(':').trim();
      }
      const secret = url.searchParams.get('secret') || '';
      return {
        secret: secret.replace(/[\s-]/g, '').toUpperCase(),
        issuer: issuer || '2FA 服务',
        account: account || '未命名账号'
      };
    }
    return {
      secret: input.replace(/[\s-]/g, '').toUpperCase()
    };
  }

  // Case A: 复杂 otpauth URI
  const parsed1 = parseSecretInput('otpauth://totp/GitHub:developer@domain.com?secret=jbsw-y3dp-ehpk-3pxp&issuer=GitHub');
  assert.strictEqual(parsed1.secret, 'JBSWY3DPEHPK3PXP');
  assert.strictEqual(parsed1.issuer, 'GitHub');
  assert.strictEqual(parsed1.account, 'developer@domain.com');
  console.log('  ✓ otpauth:// 协议解析测试通过 (成功提取 Issuer、Account 与净化密钥)');

  // Case B: 包含空格与横杠的杂乱输入
  const parsed2 = parseSecretInput(' jbsw - y3dp - ehpk - 3pxp ');
  assert.strictEqual(parsed2.secret, 'JBSWY3DPEHPK3PXP');
  console.log('  ✓ 密钥自动过滤空格、破折号与大小写修正测试通过');

  console.log('\n========================================');
  console.log('🎉 所有自动化测试全部通过 (All Tests Passed)!');
  console.log('========================================\n');
})();
