/**
 * 2FA.cash - 现代化在线 2FA / TOTP 二步验证与账号管理工具
 * 融合 2fa.cash 极简交互 + wuzf/2fa 账号系统与多格式导入导出
 */

(() => {
  'use strict';

  // ==========================================
  // 1. 核心加密与 TOTP 引擎 (RFC 6238 / RFC 4226)
  // ==========================================

  const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  function base32ToBytes(base32) {
    if (!base32) throw new Error('密钥不能为空');
    const cleaned = base32.replace(/=+$/, '').toUpperCase().replace(/[\s-]/g, '');
    let bits = '';
    for (let i = 0; i < cleaned.length; i++) {
      const val = BASE32_ALPHABET.indexOf(cleaned[i]);
      if (val === -1) {
        throw new Error(`密钥包含无效字符: "${cleaned[i]}" (Base32 仅支持 A-Z, 2-7)`);
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

  function parseSecretInput(rawInput) {
    if (!rawInput) return null;
    let input = rawInput.trim();

    if (input.startsWith('otpauth://')) {
      try {
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
        const digits = parseInt(url.searchParams.get('digits') || '6', 10);
        const period = parseInt(url.searchParams.get('period') || '30', 10);
        const algorithm = (url.searchParams.get('algorithm') || 'SHA-1').toUpperCase();

        return {
          secret: secret.replace(/[\s-]/g, '').toUpperCase(),
          issuer: issuer || '2FA 服务',
          account: account || '未命名账号',
          digits,
          period,
          algorithm
        };
      } catch (e) {
        console.error('Failed to parse otpauth URL:', e);
      }
    }

    const cleaned = input.replace(/[\s-]/g, '').toUpperCase();
    return {
      secret: cleaned,
      issuer: '',
      account: '临时取码',
      digits: 6,
      period: 30,
      algorithm: 'SHA-1'
    };
  }

  // ==========================================
  // 2. 状态变量
  // ==========================================

  let currentUser = null;
  let authToken = localStorage.getItem('2fa_cash_token') || null;

  let currentQuickConfig = null;
  let quickTimer = null;
  let batchConfigs = [];
  let batchTimer = null;
  let savedAccounts = [];
  let my2faTimer = null;

  // ==========================================
  // 3. UI 元素获取
  // ==========================================

  const tabQuickBtn = document.getElementById('tabQuickBtn');
  const tabBatchBtn = document.getElementById('tabBatchBtn');
  const tabMy2faBtn = document.getElementById('tabMy2faBtn');
  const sectionQuick = document.getElementById('sectionQuick');
  const sectionBatch = document.getElementById('sectionBatch');
  const sectionMy2fa = document.getElementById('sectionMy2fa');
  const themeToggleBtn = document.getElementById('themeToggleBtn');

  // 用户状态元素
  const headerLoginBtn = document.getElementById('headerLoginBtn');
  const loggedInGroup = document.getElementById('loggedInGroup');
  const headerUsername = document.getElementById('headerUsername');
  const userAvatarChar = document.getElementById('userAvatarChar');
  const logoutBtn = document.getElementById('logoutBtn');
  const unauthPromptCard = document.getElementById('unauthPromptCard');
  const authAccountContent = document.getElementById('authAccountContent');
  const promptLoginBtn = document.getElementById('promptLoginBtn');

  // 认证模态框
  const authModal = document.getElementById('authModal');
  const closeAuthModalBtn = document.getElementById('closeAuthModalBtn');
  const authModalTitle = document.getElementById('authModalTitle');
  const authTabLogin = document.getElementById('authTabLogin');
  const authTabRegister = document.getElementById('authTabRegister');
  const authForm = document.getElementById('authForm');
  const authUsername = document.getElementById('authUsername');
  const authPassword = document.getElementById('authPassword');
  const authSubmitBtn = document.getElementById('authSubmitBtn');
  const authErrorMsg = document.getElementById('authErrorMsg');
  let authMode = 'login';

  // 快捷取码
  const secretInput = document.getElementById('secretInput');
  const getCodeBtn = document.getElementById('getCodeBtn');
  const clearBtn = document.getElementById('clearBtn');
  const pasteBtn = document.getElementById('pasteBtn');
  const uploadQrBtn = document.getElementById('uploadQrBtn');
  const qrFileInput = document.getElementById('qrFileInput');
  const dropArea = document.getElementById('dropArea');

  const idleBox = document.getElementById('idleBox');
  const activeBox = document.getElementById('activeBox');
  const accTag = document.getElementById('accTag');
  const accLabelText = document.getElementById('accLabelText');
  const codeNumber = document.getElementById('codeNumber');
  const codeDisplayWrap = document.getElementById('codeDisplayWrap');
  const countdownCircle = document.getElementById('countdownCircle');
  const countdownText = document.getElementById('countdownText');
  const copyCodeBtn = document.getElementById('copyCodeBtn');
  const copyBtnText = document.getElementById('copyBtnText');
  const saveToMy2faQuickBtn = document.getElementById('saveToMy2faQuickBtn');

  // 批量取码
  const batchInput = document.getElementById('batchInput');
  const generateBatchBtn = document.getElementById('generateBatchBtn');
  const copyAllBatchBtn = document.getElementById('copyAllBatchBtn');
  const clearBatchBtn = document.getElementById('clearBatchBtn');
  const batchResultGrid = document.getElementById('batchResultGrid');

  // 我的 2FA
  const searchAccountInput = document.getElementById('searchAccountInput');
  const openAddModalBtn = document.getElementById('openAddModalBtn');
  const importJsonBtn = document.getElementById('importJsonBtn');
  const importJsonFileInput = document.getElementById('importJsonFileInput');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const savedAccountsGrid = document.getElementById('savedAccountsGrid');

  // 模态框
  const accountModal = document.getElementById('accountModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const accountForm = document.getElementById('accountForm');
  const editAccountId = document.getElementById('editAccountId');
  const accModalName = document.getElementById('accModalName');
  const accModalIssuer = document.getElementById('accModalIssuer');
  const accModalSecret = document.getElementById('accModalSecret');
  const modalTitle = document.getElementById('modalTitle');

  // Toast
  const toastContainer = document.getElementById('toastContainer');

  // ==========================================
  // 4. 工具函数
  // ==========================================

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    let iconSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6L9 17l-5-5"></path>
      </svg>`;
    if (type === 'error') {
      iconSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>`;
    }
    toast.innerHTML = `${iconSvg}<span>${escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px) scale(0.95)';
      setTimeout(() => toast.remove(), 250);
    }, 2400);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  async function copyText(text, successMessage = '已复制到剪贴板') {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      showToast(successMessage);
      return true;
    } catch (e) {
      showToast('复制失败，请手动长按复制', 'error');
      return false;
    }
  }

  async function apiFetch(endpoint, options = {}) {
    options.headers = options.headers || {};
    if (authToken) {
      options.headers['Authorization'] = `Bearer ${authToken}`;
    }
    if (options.body && typeof options.body === 'object') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    const res = await fetch(endpoint, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || '请求失败');
    }
    return data;
  }

  // ==========================================
  // 5. 用户鉴权 (Auth) 管理
  // ==========================================

  function updateAuthUI() {
    if (currentUser) {
      headerLoginBtn.style.display = 'none';
      loggedInGroup.style.display = 'inline-flex';
      headerUsername.textContent = currentUser.username;
      userAvatarChar.textContent = currentUser.username[0].toUpperCase();

      unauthPromptCard.style.display = 'none';
      authAccountContent.style.display = 'block';
    } else {
      headerLoginBtn.style.display = 'inline-flex';
      loggedInGroup.style.display = 'none';

      unauthPromptCard.style.display = 'block';
      authAccountContent.style.display = 'none';
    }
  }

  async function checkUserSession() {
    if (!authToken) {
      updateAuthUI();
      return;
    }
    try {
      const data = await apiFetch('/api/me');
      currentUser = data.user;
      updateAuthUI();
      loadUserAccounts();
    } catch (err) {
      console.warn('Session expired or invalid:', err);
      authToken = null;
      localStorage.removeItem('2fa_cash_token');
      currentUser = null;
      updateAuthUI();
    }
  }

  function openAuthModal(mode = 'login') {
    authMode = mode;
    authErrorMsg.style.display = 'none';
    authForm.reset();

    if (mode === 'login') {
      authModalTitle.textContent = '登录我的 2FA';
      authTabLogin.classList.add('active');
      authTabRegister.classList.remove('active');
      authSubmitBtn.textContent = '立即登录';
    } else {
      authModalTitle.textContent = '注册新账号';
      authTabRegister.classList.add('active');
      authTabLogin.classList.remove('active');
      authSubmitBtn.textContent = '注册并登录';
    }
    authModal.classList.add('open');
    authUsername.focus();
  }

  function closeAuthModal() {
    authModal.classList.remove('open');
  }

  authTabLogin.addEventListener('click', () => openAuthModal('login'));
  authTabRegister.addEventListener('click', () => openAuthModal('register'));
  headerLoginBtn.addEventListener('click', () => openAuthModal('login'));
  promptLoginBtn.addEventListener('click', () => openAuthModal('login'));
  closeAuthModalBtn.addEventListener('click', closeAuthModal);

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authErrorMsg.style.display = 'none';
    const username = authUsername.value.trim();
    const password = authPassword.value;

    authSubmitBtn.disabled = true;
    authSubmitBtn.textContent = '处理中...';

    try {
      const endpoint = authMode === 'login' ? '/api/login' : '/api/register';
      const data = await apiFetch(endpoint, {
        method: 'POST',
        body: { username, password }
      });

      currentUser = data.user;
      authToken = data.token;
      localStorage.setItem('2fa_cash_token', authToken);

      closeAuthModal();
      updateAuthUI();
      loadUserAccounts();
      showToast(authMode === 'login' ? `欢迎回来，${currentUser.username}！` : '注册并登录成功！');
    } catch (err) {
      authErrorMsg.textContent = err.message || '操作失败';
      authErrorMsg.style.display = 'block';
    } finally {
      authSubmitBtn.disabled = false;
      authSubmitBtn.textContent = authMode === 'login' ? '立即登录' : '注册并登录';
    }
  });

  logoutBtn.addEventListener('click', async () => {
    if (confirm('确定要退出登录吗？')) {
      try {
        await apiFetch('/api/logout', { method: 'POST' });
      } catch (e) {}
      authToken = null;
      localStorage.removeItem('2fa_cash_token');
      currentUser = null;
      savedAccounts = [];
      updateAuthUI();
      showToast('已安全退出登录');
    }
  });

  // 主题
  function initTheme() {
    const savedTheme = localStorage.getItem('2fa_cash_theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (prefersDark ? 'dark' : 'light');
    setTheme(theme);
  }

  function setTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('2fa_cash_theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('2fa_cash_theme', 'light');
    }
  }

  themeToggleBtn.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    setTheme(isDark ? 'light' : 'dark');
    showToast(isDark ? '已切换为浅色模式' : '已切换为深色模式');
  });

  // 导航切换
  const tabs = [
    { btn: tabQuickBtn, sec: sectionQuick },
    { btn: tabBatchBtn, sec: sectionBatch },
    { btn: tabMy2faBtn, sec: sectionMy2fa }
  ];

  tabs.forEach(tab => {
    tab.btn.addEventListener('click', () => {
      tabs.forEach(t => {
        t.btn.classList.remove('active');
        t.sec.style.display = 'none';
      });
      tab.btn.classList.add('active');
      tab.sec.style.display = 'block';

      if (tab.sec === sectionMy2fa && currentUser) {
        loadUserAccounts();
      }
    });
  });

  // ==========================================
  // 6. 快捷取码逻辑
  // ==========================================

  async function updateQuickCode() {
    if (!currentQuickConfig) return;

    try {
      const now = Date.now();
      const period = currentQuickConfig.period || 30;
      const epochSeconds = Math.floor(now / 1000);
      const remainingSeconds = period - (epochSeconds % period);

      const code = await generateTOTP(currentQuickConfig.secret, {
        period: currentQuickConfig.period,
        digits: currentQuickConfig.digits,
        algorithm: currentQuickConfig.algorithm,
        timestamp: now
      });

      // 计算下一个验证码 (参考 wuzf/2fa 实用特性)
      const nextCode = await generateTOTP(currentQuickConfig.secret, {
        period: currentQuickConfig.period,
        digits: currentQuickConfig.digits,
        algorithm: currentQuickConfig.algorithm,
        timestamp: now + period * 1000
      });

      if (code.length === 6) {
        codeNumber.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
      } else {
        codeNumber.textContent = code;
      }

      countdownText.textContent = `${remainingSeconds}s (下轮: ${nextCode.length === 6 ? nextCode.slice(0, 3) + ' ' + nextCode.slice(3) : nextCode})`;
      const circumference = 2 * Math.PI * 14;
      const offset = circumference * (1 - remainingSeconds / period);
      countdownCircle.style.strokeDashoffset = offset;

      if (remainingSeconds <= 5) {
        countdownCircle.classList.add('warning');
        countdownText.classList.add('warning');
      } else {
        countdownCircle.classList.remove('warning');
        countdownText.classList.remove('warning');
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || '计算验证码失败', 'error');
      stopQuickTimer();
    }
  }

  function startQuickTimer() {
    stopQuickTimer();
    updateQuickCode();
    quickTimer = setInterval(updateQuickCode, 1000);
  }

  function stopQuickTimer() {
    if (quickTimer) {
      clearInterval(quickTimer);
      quickTimer = null;
    }
  }

  function handleQuickGetCode() {
    const raw = secretInput.value.trim();
    if (!raw) {
      showToast('请输入 2FA 密钥或 otpauth 链接', 'error');
      secretInput.focus();
      return;
    }

    try {
      const config = parseSecretInput(raw);
      if (!config || !config.secret) {
        throw new Error('未能识别到有效的 2FA 密钥');
      }

      base32ToBytes(config.secret);

      currentQuickConfig = config;

      idleBox.style.display = 'none';
      activeBox.style.display = 'flex';

      const label = [config.issuer, config.account].filter(Boolean).join(' - ') || '2FA 验证码';
      accLabelText.textContent = label;

      startQuickTimer();
      showToast('验证码已生成！');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  getCodeBtn.addEventListener('click', handleQuickGetCode);

  secretInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleQuickGetCode();
    }
  });

  clearBtn.addEventListener('click', () => {
    secretInput.value = '';
    stopQuickTimer();
    currentQuickConfig = null;
    activeBox.style.display = 'none';
    idleBox.style.display = 'flex';
    showToast('已清空');
  });

  pasteBtn.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          secretInput.value = text;
          showToast('已从剪贴板粘贴');
          handleQuickGetCode();
        }
      } else {
        showToast('浏览器限制访问剪贴板，请使用 Ctrl+V 粘贴', 'error');
      }
    } catch (e) {
      showToast('读取剪贴板失败，请使用 Ctrl+V 粘贴', 'error');
    }
  });

  function copyCurrentQuickCode() {
    if (!codeNumber.textContent) return;
    const cleanCode = codeNumber.textContent.replace(/\s+/g, '');
    copyText(cleanCode, `验证码 ${cleanCode} 已复制！`);
    copyBtnText.textContent = '已复制！';
    setTimeout(() => {
      copyBtnText.textContent = '复制验证码';
    }, 1500);
  }

  codeDisplayWrap.addEventListener('click', copyCurrentQuickCode);
  copyCodeBtn.addEventListener('click', copyCurrentQuickCode);

  saveToMy2faQuickBtn.addEventListener('click', async () => {
    if (!currentQuickConfig) return;
    if (!currentUser) {
      showToast('请先登录账号，即可将密钥保存到云端账号库！', 'error');
      openAuthModal('login');
      return;
    }
    try {
      await apiFetch('/api/accounts', {
        method: 'POST',
        body: {
          name: currentQuickConfig.account || '快捷保存账号',
          issuer: currentQuickConfig.issuer || '',
          secret: currentQuickConfig.secret,
          algorithm: currentQuickConfig.algorithm || 'SHA-1',
          digits: currentQuickConfig.digits || 6,
          period: currentQuickConfig.period || 30
        }
      });
      showToast('已成功保存到您的专属 2FA 云端账号库！');
      loadUserAccounts();
    } catch (err) {
      showToast(err.message || '保存失败', 'error');
    }
  });

  // ==========================================
  // 7. 二维码解析 (BarcodeDetector + 拖拽 + Ctrl+V)
  // ==========================================

  async function decodeQRCodeFromImage(imgElementOrBitmap) {
    if ('BarcodeDetector' in window) {
      try {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        const barcodes = await detector.detect(imgElementOrBitmap);
        if (barcodes.length > 0) {
          return barcodes[0].rawValue;
        }
      } catch (err) {
        console.warn('BarcodeDetector detect error:', err);
      }
    }
    throw new Error('未能在图片中识别到二维码，或当前浏览器不支持原生二维码识别');
  }

  async function processImageFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      showToast('请选择有效的图片文件', 'error');
      return;
    }

    showToast('正在解析二维码...');
    try {
      const bitmap = await createImageBitmap(file);
      const rawText = await decodeQRCodeFromImage(bitmap);
      if (rawText) {
        secretInput.value = rawText;
        showToast('二维码识别成功！');
        handleQuickGetCode();
      } else {
        throw new Error('未识别到二维码数据');
      }
    } catch (err) {
      showToast(err.message || '识别二维码失败', 'error');
    }
  }

  uploadQrBtn.addEventListener('click', () => qrFileInput.click());
  qrFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      processImageFile(e.target.files[0]);
      e.target.value = '';
    }
  });

  dropArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropArea.classList.add('dragover');
  });

  dropArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropArea.classList.remove('dragover');
  });

  dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dropArea.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processImageFile(e.dataTransfer.files[0]);
    }
  });

  window.addEventListener('paste', (e) => {
    const items = (e.clipboardData || window.clipboardData).items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          processImageFile(file);
          break;
        }
      }
    }
  });

  // ==========================================
  // 8. 批量取码逻辑
  // ==========================================

  function parseBatchLines(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const results = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let name = `账号 ${i + 1}`;
      let secretRaw = line;

      if (line.includes(':')) {
        const parts = line.split(':');
        name = parts[0].trim();
        secretRaw = parts.slice(1).join(':').trim();
      } else if (line.includes('\t')) {
        const parts = line.split('\t');
        name = parts[0].trim();
        secretRaw = parts[1].trim();
      } else if (line.includes(' ') && !line.startsWith('otpauth://')) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          name = parts[0].trim();
          secretRaw = parts.slice(1).join(' ').trim();
        }
      }

      const parsed = parseSecretInput(secretRaw);
      if (parsed && parsed.secret) {
        results.push({
          id: 'batch_' + i,
          name: parsed.issuer ? `${parsed.issuer} (${name})` : name,
          config: parsed,
          lastCode: '------'
        });
      }
    }
    return results;
  }

  async function updateBatchCodes() {
    if (!batchConfigs.length) return;
    const now = Date.now();
    const period = 30;
    const remaining = period - (Math.floor(now / 1000) % period);

    for (const item of batchConfigs) {
      try {
        const code = await generateTOTP(item.config.secret, {
          period: item.config.period,
          digits: item.config.digits,
          algorithm: item.config.algorithm,
          timestamp: now
        });
        item.lastCode = code;

        const codeEl = document.getElementById(`batch_code_${item.id}`);
        const cdEl = document.getElementById(`batch_cd_${item.id}`);
        if (codeEl) {
          codeEl.textContent = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
        }
        if (cdEl) {
          cdEl.textContent = `${remaining}s`;
          cdEl.style.color = remaining <= 5 ? 'var(--danger)' : 'var(--text-muted)';
        }
      } catch (err) {
        console.error(err);
      }
    }
  }

  function renderBatchGrid() {
    if (!batchConfigs.length) {
      batchResultGrid.innerHTML = `
        <div class="empty-state">
          <p>暂无批量结果，请在上方输入多行密钥后点击「生成批量验证码」</p>
        </div>`;
      return;
    }

    batchResultGrid.innerHTML = batchConfigs.map(item => `
      <div class="batch-item-card">
        <div class="batch-item-header">
          <span class="batch-item-title" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
          <span id="batch_cd_${item.id}" style="font-family: ui-monospace; font-size: 0.8rem; color: var(--text-muted);">30s</span>
        </div>
        <div class="batch-item-code" id="batch_code_${item.id}">------</div>
        <div class="batch-item-footer">
          <button class="btn btn-outline btn-sm" onclick="window._copyBatchItem('${item.id}')" style="width: 100%;">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
            </svg>
            <span>复制</span>
          </button>
        </div>
      </div>
    `).join('');
  }

  window._copyBatchItem = (id) => {
    const item = batchConfigs.find(x => x.id === id);
    if (item && item.lastCode) {
      copyText(item.lastCode, `${item.name}: ${item.lastCode} 已复制！`);
    }
  };

  generateBatchBtn.addEventListener('click', () => {
    const raw = batchInput.value.trim();
    if (!raw) {
      showToast('请输入批量密钥', 'error');
      return;
    }
    batchConfigs = parseBatchLines(raw);
    if (!batchConfigs.length) {
      showToast('未能从输入中解析出有效的 2FA 密钥', 'error');
      return;
    }

    renderBatchGrid();
    if (batchTimer) clearInterval(batchTimer);
    updateBatchCodes();
    batchTimer = setInterval(updateBatchCodes, 1000);
    showToast(`成功解析 ${batchConfigs.length} 个账号验证码！`);
  });

  copyAllBatchBtn.addEventListener('click', () => {
    if (!batchConfigs.length) {
      showToast('没有可复制的验证码', 'error');
      return;
    }
    const lines = batchConfigs.map(item => `${item.name}: ${item.lastCode || '------'}`);
    copyText(lines.join('\n'), `已复制全部 ${batchConfigs.length} 个最新验证码！`);
  });

  clearBatchBtn.addEventListener('click', () => {
    batchInput.value = '';
    batchConfigs = [];
    if (batchTimer) clearInterval(batchTimer);
    renderBatchGrid();
    showToast('已清空批量列表');
  });

  // ==========================================
  // 9. 我的 2FA (用户专属云端账号库)
  // ==========================================

  async function loadUserAccounts() {
    if (!currentUser) return;
    try {
      const data = await apiFetch('/api/accounts');
      savedAccounts = data.accounts || [];
      renderMy2faAccounts();
    } catch (err) {
      console.error(err);
      showToast('加载账号列表失败: ' + err.message, 'error');
    }
  }

  async function updateMy2faLiveCodes() {
    const now = Date.now();
    const period = 30;
    const remaining = period - (Math.floor(now / 1000) % period);

    for (const acc of savedAccounts) {
      try {
        const code = await generateTOTP(acc.secret, {
          period: acc.period || 30,
          digits: acc.digits || 6,
          algorithm: acc.algorithm || 'SHA-1',
          timestamp: now
        });
        const nextCode = await generateTOTP(acc.secret, {
          period: acc.period || 30,
          digits: acc.digits || 6,
          algorithm: acc.algorithm || 'SHA-1',
          timestamp: now + (acc.period || 30) * 1000
        });
        acc._code = code;
        acc._nextCode = nextCode;

        const codeEl = document.getElementById(`acc_code_val_${acc.id}`);
        const cdEl = document.getElementById(`acc_cd_${acc.id}`);
        const nextEl = document.getElementById(`acc_next_${acc.id}`);
        if (codeEl) {
          codeEl.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
        }
        if (cdEl) {
          cdEl.textContent = `${remaining}s`;
          cdEl.style.color = remaining <= 5 ? 'var(--danger)' : 'var(--text-muted)';
        }
        if (nextEl) {
          nextEl.textContent = `下轮: ${nextCode.slice(0,3)} ${nextCode.slice(3)}`;
        }
      } catch (err) {
        console.error(err);
      }
    }
  }

  function renderMy2faAccounts() {
    const keyword = searchAccountInput.value.trim().toLowerCase();
    const filtered = savedAccounts.filter(acc => {
      if (!keyword) return true;
      return (acc.name && acc.name.toLowerCase().includes(keyword)) ||
             (acc.issuer && acc.issuer.toLowerCase().includes(keyword));
    });

    if (!filtered.length) {
      savedAccountsGrid.innerHTML = `
        <div class="empty-state">
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2"></rect>
            <path d="M7 10V7a5 5 0 0 1 10 0v3"></path>
          </svg>
          <p style="font-size: 1rem; font-weight: 600; margin-bottom: 0.5rem;">暂无保存的 2FA 账号</p>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.25rem;">点击上方「添加账号」或在首页快捷取码中一键保存。</p>
          <button class="btn btn-outline btn-sm" onclick="document.getElementById('openAddModalBtn').click()">添加第一个账号</button>
        </div>`;
      return;
    }

    savedAccountsGrid.innerHTML = filtered.map(acc => {
      const initial = (acc.issuer || acc.name || '2F')[0].toUpperCase();
      return `
        <div class="saved-account-card">
          <div class="acc-card-top">
            <div style="display: flex; align-items: center; flex: 1; overflow: hidden;">
              <div class="acc-avatar">${initial}</div>
              <div class="acc-info">
                <div class="acc-name" title="${escapeHtml(acc.name)}">${escapeHtml(acc.name)}</div>
                <div class="acc-issuer" title="${escapeHtml(acc.issuer || 'TOTP')}">${escapeHtml(acc.issuer || 'TOTP 验证码')}</div>
              </div>
            </div>
            <div class="acc-actions-dropdown">
              <button class="icon-btn" onclick="window._copyAccountUri('${acc.id}')" title="复制 otpauth:// 链接">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
              </button>
              <button class="icon-btn" onclick="window._editAccount('${acc.id}')" title="编辑">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 20h9"></path>
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
                </svg>
              </button>
              <button class="icon-btn" onclick="window._deleteAccount('${acc.id}')" title="删除">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 6h18"></path>
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>

          <div class="acc-code-row" onclick="window._copyAccountCode('${acc.id}')" title="点击复制验证码">
            <div>
              <div class="acc-code-val" id="acc_code_val_${acc.id}">${acc._code ? `${acc._code.slice(0,3)} ${acc._code.slice(3)}` : '000 000'}</div>
              <div id="acc_next_${acc.id}" style="font-size: 0.72rem; color: var(--text-sub); margin-top: 2px;">下轮: ------</div>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span id="acc_cd_${acc.id}" style="font-family: ui-monospace; font-size: 0.85rem; font-weight: 600; color: var(--text-muted);">30s</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
              </svg>
            </div>
          </div>
        </div>
      `;
    }).join('');

    updateMy2faLiveCodes();
  }

  window._copyAccountCode = (id) => {
    const acc = savedAccounts.find(x => x.id === id);
    if (acc && acc._code) {
      copyText(acc._code, `${acc.name}: ${acc._code} 已复制！`);
    }
  };

  window._copyAccountUri = (id) => {
    const acc = savedAccounts.find(x => x.id === id);
    if (acc) {
      const uri = `otpauth://totp/${encodeURIComponent(acc.issuer ? acc.issuer + ':' + acc.name : acc.name)}?secret=${acc.secret}&issuer=${encodeURIComponent(acc.issuer || '')}&digits=${acc.digits || 6}&period=${acc.period || 30}`;
      copyText(uri, '已复制 otpauth:// 链接');
    }
  };

  window._editAccount = (id) => {
    const acc = savedAccounts.find(x => x.id === id);
    if (!acc) return;
    editAccountId.value = acc.id;
    accModalName.value = acc.name;
    accModalIssuer.value = acc.issuer || '';
    accModalSecret.value = acc.secret;
    modalTitle.textContent = '编辑 2FA 账号';
    accountModal.classList.add('open');
  };

  window._deleteAccount = async (id) => {
    const acc = savedAccounts.find(x => x.id === id);
    if (!acc) return;
    if (confirm(`确定要删除账号「${acc.name}」吗？`)) {
      try {
        await apiFetch(`/api/accounts/${id}`, { method: 'DELETE' });
        savedAccounts = savedAccounts.filter(x => x.id !== id);
        renderMy2faAccounts();
        showToast('已从云端删除账号');
      } catch (err) {
        showToast(err.message || '删除失败', 'error');
      }
    }
  };

  searchAccountInput.addEventListener('input', renderMy2faAccounts);

  function openAddModal() {
    if (!currentUser) {
      showToast('请先登录账号', 'error');
      openAuthModal('login');
      return;
    }
    editAccountId.value = '';
    accountForm.reset();
    modalTitle.textContent = '添加 2FA 账号';
    accountModal.classList.add('open');
    accModalName.focus();
  }

  function closeModal() {
    accountModal.classList.remove('open');
  }

  openAddModalBtn.addEventListener('click', openAddModal);
  closeModalBtn.addEventListener('click', closeModal);
  cancelModalBtn.addEventListener('click', closeModal);

  accountForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = accModalName.value.trim();
    const issuer = accModalIssuer.value.trim();
    const secretInputVal = accModalSecret.value.trim();

    try {
      const parsed = parseSecretInput(secretInputVal);
      if (!parsed || !parsed.secret) {
        throw new Error('无效的 2FA 密钥');
      }
      base32ToBytes(parsed.secret);

      const id = editAccountId.value;
      if (id) {
        await apiFetch(`/api/accounts/${id}`, {
          method: 'PUT',
          body: {
            name,
            issuer: issuer || parsed.issuer,
            secret: parsed.secret
          }
        });
        showToast('账号更新成功！');
      } else {
        await apiFetch('/api/accounts', {
          method: 'POST',
          body: {
            name,
            issuer: issuer || parsed.issuer,
            secret: parsed.secret,
            algorithm: parsed.algorithm,
            digits: parsed.digits,
            period: parsed.period
          }
        });
        showToast('账号已保存到云端数据库！');
      }

      closeModal();
      loadUserAccounts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // 多格式导出备份 (参考 wuzf/2fa 支持 TXT / JSON)
  exportJsonBtn.addEventListener('click', () => {
    if (!savedAccounts.length) {
      showToast('当前没有账号可导出', 'error');
      return;
    }

    const cleanList = savedAccounts.map(a => ({
      name: a.name,
      issuer: a.issuer,
      secret: a.secret,
      algorithm: a.algorithm,
      digits: a.digits,
      period: a.period
    }));

    // 生成标准 otpauth:// URI 文本
    const txtContent = cleanList.map(a => {
      const label = a.issuer ? `${a.issuer}:${a.name}` : a.name;
      return `otpauth://totp/${encodeURIComponent(label)}?secret=${a.secret}&issuer=${encodeURIComponent(a.issuer || '')}&algorithm=${a.algorithm || 'SHA-1'}&digits=${a.digits || 6}&period=${a.period || 30}`;
    }).join('\n');

    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', url);
    downloadAnchor.setAttribute('download', `2fa_backup_${currentUser ? currentUser.username : 'accounts'}_${new Date().toISOString().slice(0, 10)}.txt`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    URL.revokeObjectURL(url);
    showToast('标准 2FA 备份文件已下载！');
  });

  // 多格式导入备份 (支持 TXT / JSON)
  importJsonBtn.addEventListener('click', () => {
    if (!currentUser) {
      showToast('请先登录账号后再导入备份', 'error');
      openAuthModal('login');
      return;
    }
    importJsonFileInput.click();
  });

  importJsonFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target.result;
        let accountsToImport = [];

        // 尝试解析为 JSON
        if (text.trim().startsWith('[') || text.trim().startsWith('{')) {
          try {
            const parsedJson = JSON.parse(text);
            accountsToImport = Array.isArray(parsedJson) ? parsedJson : (parsedJson.accounts || []);
          } catch (e) {}
        }

        // 如果不是 JSON，作为 TXT 多行 otpauth:// 或 Name: Secret 解析
        if (!accountsToImport.length) {
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          for (let i = 0; i < lines.length; i++) {
            const parsed = parseSecretInput(lines[i]);
            if (parsed && parsed.secret) {
              accountsToImport.push({
                name: parsed.account || `导入账号 ${i + 1}`,
                issuer: parsed.issuer || '',
                secret: parsed.secret,
                algorithm: parsed.algorithm,
                digits: parsed.digits,
                period: parsed.period
              });
            }
          }
        }

        if (accountsToImport.length > 0) {
          const res = await apiFetch('/api/accounts/batch-import', {
            method: 'POST',
            body: { accounts: accountsToImport }
          });
          showToast(`成功导入 ${res.count} 个账号！`);
          loadUserAccounts();
        } else {
          throw new Error('未能在文件中识别到有效的 2FA 账号或密钥');
        }
      } catch (err) {
        showToast(err.message || '导入失败，请检查文件格式', 'error');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  document.getElementById('helpModalLink').addEventListener('click', () => {
    alert('【2FA 工具使用说明】\n\n1. 登录云端保存：点击右上角「登录 / 注册」，注册专属账号后，在「我的 2FA」中添加的账号将永久安全保存在云端数据库，换电脑换手机登录即刻同步！\n2. 快捷取码：免登录临时即开即用，输入密钥或按 Ctrl+V 粘贴二维码图片即可秒出验证码。\n3. 下一轮预告：实时展示下轮验证码，避免倒计时临期输入失效。\n4. 公开 URL 取码：可通过 http://localhost:3000/otp/你的密钥 随时在浏览器中查看验证码。');
  });

  document.getElementById('privacyLink').addEventListener('click', () => {
    alert('【安全与隐私保障】\n\n1. 密码安全：用户密码采用业界标准的 PBKDF2-SHA512 + 随机盐哈希加密存储。\n2. 多用户隔离：每个用户只能访问和管理属于自己的 2FA 账号列表。\n3. 本地计算：TOTP 验证码在您的浏览器本地毫秒级生成。');
  });

  // ==========================================
  // 10. 初始化
  // ==========================================

  initTheme();
  checkUserSession();

  my2faTimer = setInterval(() => {
    if (sectionMy2fa.style.display !== 'none' && currentUser) {
      updateMy2faLiveCodes();
    }
  }, 1000);

})();
