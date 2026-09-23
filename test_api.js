const assert = require('assert');
const db = require('./db');

console.log('========================================');
console.log('🧪 开始 2FA 账户系统与数据库隔离测试');
console.log('========================================\n');

try {
  // 1. 用户注册与密码加密
  console.log('[Test 1] 测试用户注册与哈希加密...');
  const testUser = db.createUser('alice_' + Date.now(), 'mySecretPass123');
  assert(testUser.id, 'User ID 应生成');
  assert(testUser.username.startsWith('alice_'), 'Username 应匹配');

  const found = db.findUserByUsername(testUser.username);
  assert(found, '应能按用户名查找用户');
  assert.notStrictEqual(found.passwordHash, 'mySecretPass123', '数据库中密码必须被哈希，不能存明文');
  assert(db.verifyPassword('mySecretPass123', found.passwordHash, found.salt), '密码验证应成功');
  assert(!db.verifyPassword('wrongPassword', found.passwordHash, found.salt), '错误密码应验证失败');
  console.log('  ✓ 用户注册与 PBKDF2-SHA512 哈希测试通过');

  // 2. 会话 Token 鉴权
  console.log('\n[Test 2] 测试 Session Token 鉴权与生命周期...');
  const token = db.createSession(testUser.id);
  assert(token && token.length === 64, 'Token 应为 64 位安全随机字符');
  const sessionUser = db.getUserByToken(token);
  assert.strictEqual(sessionUser.id, testUser.id, 'Token 解析应返回正确用户');
  db.deleteSession(token);
  assert.strictEqual(db.getUserByToken(token), null, '退出登录后 Token 应失效');
  console.log('  ✓ Session Token 生成、鉴权与退出测试通过');

  // 3. 用户 2FA 账号添加与持久化
  console.log('\n[Test 3] 测试用户 2FA 账号保存与 CRUD 操作...');
  const newAcc = db.addAccount(testUser.id, {
    name: 'GitHub 生产账号',
    issuer: 'GitHub',
    secret: 'JBSWY3DPEHPK3PXP'
  });
  assert(newAcc.id, '账号 ID 应生成');
  assert.strictEqual(newAcc.secret, 'JBSWY3DPEHPK3PXP');

  let list = db.getAccountsByUserId(testUser.id);
  assert.strictEqual(list.length, 1, '应有 1 个保存的账号');
  assert.strictEqual(list[0].name, 'GitHub 生产账号');

  // 更新
  db.updateAccount(testUser.id, newAcc.id, { name: 'GitHub 主账号' });
  list = db.getAccountsByUserId(testUser.id);
  assert.strictEqual(list[0].name, 'GitHub 主账号');

  // 批量导入
  db.batchImportAccounts(testUser.id, [
    { name: 'Google Workspace', issuer: 'Google', secret: 'HXDMVGJ56XTRI8WB' },
    { name: 'Binance', issuer: 'Binance', secret: '4S62JXOMO5P734D7' }
  ]);
  list = db.getAccountsByUserId(testUser.id);
  assert.strictEqual(list.length, 3, '批量导入后应有 3 个账号');
  console.log('  ✓ 2FA 账号创建、更新与批量导入测试通过');

  // 4. 多用户严格数据隔离测试
  console.log('\n[Test 4] 测试多用户严格隔离 (Alice 与 Bob 互相看不见对方密钥)...');
  const bobUser = db.createUser('bob_' + Date.now(), 'bobSecretPass123');
  const bobList = db.getAccountsByUserId(bobUser.id);
  assert.strictEqual(bobList.length, 0, '新用户 Bob 的账号库应为空');

  // Bob 尝试删除 Alice 的账号应报错
  let caught = false;
  try {
    db.updateAccount(bobUser.id, newAcc.id, { name: '黑客修改' });
  } catch (e) {
    caught = true;
  }
  assert(caught, 'Bob 越权修改 Alice 的账号应被拦截');

  // 删除
  db.deleteAccount(testUser.id, newAcc.id);
  list = db.getAccountsByUserId(testUser.id);
  assert.strictEqual(list.length, 2, '删除后应剩余 2 个账号');
  console.log('  ✓ 多用户数据隔离与防越权测试通过');

  console.log('\n========================================');
  console.log('🎉 账号系统与云端数据库测试全部通过！');
  console.log('========================================\n');
} catch (err) {
  console.error('❌ 测试失败:', err);
  process.exit(1);
}
