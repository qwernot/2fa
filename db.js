const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, 'data', 'db.json');
const TMP_FILE = path.join(__dirname, 'data', 'db.tmp.json');

const defaultData = {
  users: [],       // [{ id, username, passwordHash, salt, createdAt }]
  sessions: [],    // [{ token, userId, expiresAt }]
  accounts: []     // [{ id, userId, name, issuer, secret, algorithm, digits, period, createdAt, updatedAt }]
};

let db = { ...defaultData };

function initDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf8');
      db = JSON.parse(content);
      if (!Array.isArray(db.users)) db.users = [];
      if (!Array.isArray(db.sessions)) db.sessions = [];
      if (!Array.isArray(db.accounts)) db.accounts = [];
    } else {
      saveDB();
    }
  } catch (err) {
    console.error('Error loading db.json, resetting to empty schema:', err);
    db = { ...defaultData };
    saveDB();
  }
}

function saveDB() {
  try {
    const json = JSON.stringify(db, null, 2);
    fs.writeFileSync(TMP_FILE, json, 'utf8');
    fs.renameSync(TMP_FILE, DB_FILE);
  } catch (err) {
    console.error('Failed to write db.json:', err);
  }
}

// 密码安全哈希 (PBKDF2-SHA512)
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const check = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return check === hash;
}

// 用户操作
function findUserByUsername(username) {
  if (!username) return null;
  const cleanName = username.trim().toLowerCase();
  return db.users.find(u => u.username.toLowerCase() === cleanName) || null;
}

function findUserById(id) {
  return db.users.find(u => u.id === id) || null;
}

function createUser(username, password) {
  const cleanName = username.trim();
  if (findUserByUsername(cleanName)) {
    throw new Error('该用户名已被注册');
  }

  const { hash, salt } = hashPassword(password);
  const user = {
    id: 'u_' + crypto.randomBytes(8).toString('hex'),
    username: cleanName,
    passwordHash: hash,
    salt,
    createdAt: Date.now()
  };

  db.users.push(user);
  saveDB();
  return { id: user.id, username: user.username };
}

// Session 操作
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    token,
    userId,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30天有效
  };
  db.sessions.push(session);
  saveDB();
  return token;
}

function getUserByToken(token) {
  if (!token) return null;
  const session = db.sessions.find(s => s.token === token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    // 过期清理
    deleteSession(token);
    return null;
  }
  const user = findUserById(session.userId);
  if (!user) return null;
  return { id: user.id, username: user.username };
}

function deleteSession(token) {
  db.sessions = db.sessions.filter(s => s.token !== token);
  saveDB();
}

// 2FA 账号操作 (与特定 userId 绑定)
function getAccountsByUserId(userId) {
  return db.accounts
    .filter(a => a.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function addAccount(userId, { name, issuer, secret, algorithm = 'SHA-1', digits = 6, period = 30 }) {
  const acc = {
    id: 'acc_' + crypto.randomBytes(8).toString('hex'),
    userId,
    name: name.trim(),
    issuer: (issuer || '').trim(),
    secret: secret.trim().replace(/[\s-]/g, '').toUpperCase(),
    algorithm: algorithm || 'SHA-1',
    digits: parseInt(digits, 10) || 6,
    period: parseInt(period, 10) || 30,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  db.accounts.push(acc);
  saveDB();
  return acc;
}

function updateAccount(userId, accountId, { name, issuer, secret }) {
  const acc = db.accounts.find(a => a.id === accountId && a.userId === userId);
  if (!acc) throw new Error('账号不存在或无权操作');

  if (name !== undefined) acc.name = name.trim();
  if (issuer !== undefined) acc.issuer = (issuer || '').trim();
  if (secret !== undefined) acc.secret = secret.trim().replace(/[\s-]/g, '').toUpperCase();
  acc.updatedAt = Date.now();

  saveDB();
  return acc;
}

function deleteAccount(userId, accountId) {
  const prevLen = db.accounts.length;
  db.accounts = db.accounts.filter(a => !(a.id === accountId && a.userId === userId));
  const changed = db.accounts.length !== prevLen;
  if (changed) saveDB();
  return changed;
}

function batchImportAccounts(userId, list) {
  let count = 0;
  for (const item of list) {
    if (!item.secret) continue;
    db.accounts.push({
      id: 'acc_' + crypto.randomBytes(8).toString('hex'),
      userId,
      name: (item.name || '导入账号').trim(),
      issuer: (item.issuer || '').trim(),
      secret: item.secret.trim().replace(/[\s-]/g, '').toUpperCase(),
      algorithm: item.algorithm || 'SHA-1',
      digits: parseInt(item.digits, 10) || 6,
      period: parseInt(item.period, 10) || 30,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    count++;
  }
  if (count > 0) saveDB();
  return count;
}

initDB();

module.exports = {
  findUserByUsername,
  verifyPassword,
  createUser,
  createSession,
  getUserByToken,
  deleteSession,
  getAccountsByUserId,
  addAccount,
  updateAccount,
  deleteAccount,
  batchImportAccounts
};
