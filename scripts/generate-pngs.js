/**
 * Cosmo 2FA - 网站图标与图表 PNG 导出生成脚本
 * 利用 Headless Chrome 高精度渲染视网膜级 PNG 图片
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OUTPUT_DIR = path.join(__dirname, '../assets/png');
const TEMP_DIR = path.join(__dirname, '../assets/temp_html');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// 1. 定义要生成的一系列图表与图标
const ITEMS = [
  // 核心应用主图标 (Apple VisionOS / iOS 毛玻璃质感 512x512)
  {
    name: 'logo-512.png',
    width: 512,
    height: 512,
    html: `
      <div style="width: 512px; height: 512px; display: flex; align-items: center; justify-content: center; background: transparent;">
        <div style="
          width: 440px; 
          height: 440px; 
          border-radius: 98px; 
          background: linear-gradient(145deg, #0a84ff 0%, #0066cc 60%, #004b99 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 32px 64px rgba(0, 102, 204, 0.45), inset 0 2px 4px rgba(255, 255, 255, 0.4), inset 0 -4px 8px rgba(0, 0, 0, 0.2);
          position: relative;
        ">
          <!-- 微光外边框 -->
          <div style="position: absolute; inset: 0; border-radius: 98px; border: 1.5px solid rgba(255, 255, 255, 0.25); pointer-events: none;"></div>
          <!-- 钥匙图标 -->
          <svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.25));">
            <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"></path>
            <circle cx="16.5" cy="7.5" r=".5" fill="#ffffff"></circle>
          </svg>
        </div>
      </div>
    `
  },

  // 圆形头像版图标 (256x256)
  {
    name: 'logo-circle.png',
    width: 256,
    height: 256,
    html: `
      <div style="width: 256px; height: 256px; display: flex; align-items: center; justify-content: center; background: transparent;">
        <div style="
          width: 240px; 
          height: 240px; 
          border-radius: 50%; 
          background: linear-gradient(135deg, #0a84ff 0%, #005bb5 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 16px 36px rgba(0, 113, 227, 0.4), inset 0 2px 3px rgba(255, 255, 255, 0.35);
          position: relative;
        ">
          <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.2));">
            <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"></path>
            <circle cx="16.5" cy="7.5" r=".5" fill="#ffffff"></circle>
          </svg>
        </div>
      </div>
    `
  },

  // 透明纯钥匙图标 (256x256)
  {
    name: 'logo-transparent.png',
    width: 256,
    height: 256,
    html: `
      <div style="width: 256px; height: 256px; display: flex; align-items: center; justify-content: center; background: transparent;">
        <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="#0a84ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 6px 16px rgba(10, 132, 255, 0.4));">
          <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"></path>
          <circle cx="16.5" cy="7.5" r=".5" fill="#0a84ff"></circle>
        </svg>
      </div>
    `
  },

  // 横版品牌 Logo + 文字 (Brand Banner 700x200)
  {
    name: 'brand-banner.png',
    width: 700,
    height: 200,
    html: `
      <div style="width: 700px; height: 200px; display: flex; align-items: center; padding: 0 40px; background: transparent; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'PingFang SC', sans-serif;">
        <div style="
          width: 110px; 
          height: 110px; 
          border-radius: 26px; 
          background: linear-gradient(135deg, #0a84ff 0%, #0066cc 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 12px 28px rgba(0, 102, 204, 0.35), inset 0 1px 2px rgba(255, 255, 255, 0.4);
          margin-right: 28px;
        ">
          <svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"></path>
            <circle cx="16.5" cy="7.5" r=".5" fill="#ffffff"></circle>
          </svg>
        </div>
        <div>
          <div style="font-size: 56px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em;">
            Cosmo <span style="color: #64748b; font-weight: 400;">2FA</span>
          </div>
          <div style="font-size: 20px; color: #94a3b8; margin-top: 6px; font-weight: 500;">
            极简安全双因子验证 · 多端离线与云同步
          </div>
        </div>
      </div>
    `
  },

  // 环形倒计时进度图表 (Progress Ring Chart 400x400)
  {
    name: 'chart-countdown-ring.png',
    width: 400,
    height: 400,
    html: `
      <div style="width: 400px; height: 400px; display: flex; align-items: center; justify-content: center; background: transparent; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;">
        <div style="
          width: 340px; 
          height: 340px; 
          border-radius: 50%; 
          background: rgba(255, 255, 255, 0.05); 
          border: 1px solid rgba(255, 255, 255, 0.1); 
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5); 
          display: flex; 
          align-items: center; 
          justify-content: center;
          position: relative;
        ">
          <svg width="280" height="280" viewBox="0 0 120 120">
            <!-- 背景圆环 -->
            <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255, 255, 255, 0.08)" stroke-width="8"></circle>
            <!-- 动态绿色进度弧线 (剩余 24s / 80%) -->
            <circle cx="60" cy="60" r="50" fill="none" stroke="#10b981" stroke-width="8" stroke-linecap="round" stroke-dasharray="314.16" stroke-dashoffset="62.8" transform="rotate(-90 60 60)" style="filter: drop-shadow(0 0 8px rgba(16, 185, 129, 0.5));"></circle>
          </svg>
          <!-- 中心数字 -->
          <div style="position: absolute; text-align: center;">
            <div style="font-size: 52px; font-weight: 800; color: #10b981; font-family: 'SF Pro Rounded', monospace;">24s</div>
            <div style="font-size: 16px; color: #94a3b8; font-weight: 500; margin-top: 4px;">周期刷新</div>
          </div>
        </div>
      </div>
    `
  },

  // 紧急即将到期倒计时环形图表 (Urgent Countdown Chart 400x400)
  {
    name: 'chart-countdown-urgent.png',
    width: 400,
    height: 400,
    html: `
      <div style="width: 400px; height: 400px; display: flex; align-items: center; justify-content: center; background: transparent; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;">
        <div style="
          width: 340px; 
          height: 340px; 
          border-radius: 50%; 
          background: rgba(239, 68, 68, 0.06); 
          border: 1px solid rgba(239, 68, 68, 0.25); 
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5); 
          display: flex; 
          align-items: center; 
          justify-content: center;
          position: relative;
        ">
          <svg width="280" height="280" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255, 255, 255, 0.08)" stroke-width="8"></circle>
            <!-- 红色急促进度弧线 (剩余 4s / 13%) -->
            <circle cx="60" cy="60" r="50" fill="none" stroke="#ef4444" stroke-width="8" stroke-linecap="round" stroke-dasharray="314.16" stroke-dashoffset="273.3" transform="rotate(-90 60 60)" style="filter: drop-shadow(0 0 10px rgba(239, 68, 68, 0.7));"></circle>
          </svg>
          <div style="position: absolute; text-align: center;">
            <div style="font-size: 52px; font-weight: 800; color: #ef4444; font-family: 'SF Pro Rounded', monospace;">04s</div>
            <div style="font-size: 16px; color: #f87171; font-weight: 500; margin-top: 4px;">即将到期</div>
          </div>
        </div>
      </div>
    `
  },

  // 3 步骤流程图表 (Workflow Chart 800x220)
  {
    name: 'chart-workflow-steps.png',
    width: 800,
    height: 220,
    html: `
      <div style="width: 800px; height: 220px; display: flex; align-items: center; justify-content: space-between; padding: 20px 40px; background: transparent; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'PingFang SC', sans-serif;">
        <!-- Step 1 -->
        <div style="flex: 1; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px; padding: 24px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,0.3);">
          <div style="font-size: 32px; font-weight: 800; color: #3b82f6; margin-bottom: 8px;">01</div>
          <div style="font-size: 18px; font-weight: 700; color: #f8fafc;">输入密钥 / 扫码</div>
          <div style="font-size: 13px; color: #64748b; margin-top: 4px;">Base32 密文或二维码</div>
        </div>

        <div style="font-size: 28px; color: #475569; margin: 0 16px;">➔</div>

        <!-- Step 2 -->
        <div style="flex: 1; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px; padding: 24px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,0.3);">
          <div style="font-size: 32px; font-weight: 800; color: #10b981; margin-bottom: 8px;">02</div>
          <div style="font-size: 18px; font-weight: 700; color: #f8fafc;">瞬时计算验证码</div>
          <div style="font-size: 13px; color: #64748b; margin-top: 4px;">RFC 6238 本地离线算法</div>
        </div>

        <div style="font-size: 28px; color: #475569; margin: 0 16px;">➔</div>

        <!-- Step 3 -->
        <div style="flex: 1; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px; padding: 24px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,0.3);">
          <div style="font-size: 32px; font-weight: 800; color: #8b5cf6; margin-bottom: 8px;">03</div>
          <div style="font-size: 18px; font-weight: 700; color: #f8fafc;">一键复制使用</div>
          <div style="font-size: 13px; color: #64748b; margin-top: 4px;">30s 动态自动滚动更新</div>
        </div>
      </div>
    `
  },

  // 常用功能 UI 图标集 (透明背景 256x256)
  {
    name: 'icon-key.png',
    width: 256,
    height: 256,
    html: `
      <div style="width: 256px; height: 256px; display: flex; align-items: center; justify-content: center; background: transparent;">
        <svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"></path>
          <circle cx="16.5" cy="7.5" r=".5" fill="#38bdf8"></circle>
        </svg>
      </div>
    `
  },
  {
    name: 'icon-lock.png',
    width: 256,
    height: 256,
    html: `
      <div style="width: 256px; height: 256px; display: flex; align-items: center; justify-content: center; background: transparent;">
        <svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
      </div>
    `
  },
  {
    name: 'icon-shield.png',
    width: 256,
    height: 256,
    html: `
      <div style="width: 256px; height: 256px; display: flex; align-items: center; justify-content: center; background: transparent;">
        <svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path>
          <path d="m9 12 2 2 4-4"></path>
        </svg>
      </div>
    `
  },
  {
    name: 'icon-lightning.png',
    width: 256,
    height: 256,
    html: `
      <div style="width: 256px; height: 256px; display: flex; align-items: center; justify-content: center; background: transparent;">
        <svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg>
      </div>
    `
  },
  {
    name: 'icon-matrix.png',
    width: 256,
    height: 256,
    html: `
      <div style="width: 256px; height: 256px; display: flex; align-items: center; justify-content: center; background: transparent;">
        <svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2"></rect>
          <path d="M3 9h18"></path>
          <path d="M3 15h18"></path>
          <path d="M9 3v18"></path>
        </svg>
      </div>
    `
  },
  {
    name: 'icon-qrcode.png',
    width: 256,
    height: 256,
    html: `
      <div style="width: 256px; height: 256px; display: flex; align-items: center; justify-content: center; background: transparent;">
        <svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 24 24" fill="none" stroke="#f472b6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="5" height="5" x="3" y="3" rx="1"></rect>
          <rect width="5" height="5" x="16" y="3" rx="1"></rect>
          <rect width="5" height="5" x="3" y="16" rx="1"></rect>
          <path d="M21 16h-3a2 2 0 0 0-2 2v3"></path>
          <path d="M21 21v.01"></path>
          <path d="M12 7v3a2 2 0 0 1-2 2H7"></path>
          <path d="M3 12h.01"></path>
          <path d="M12 3h.01"></path>
          <path d="M12 16v.01"></path>
          <path d="M16 12h1"></path>
          <path d="M21 12v.01"></path>
          <path d="M12 21v-1"></path>
        </svg>
      </div>
    `
  }
];

async function generateAll() {
  console.log(`🚀 开始提取并生成 ${ITEMS.length} 个 PNG 图标与图表...`);

  for (const item of ITEMS) {
    const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: ${item.width}px; height: ${item.height}px; overflow: hidden; background: transparent; }
  </style>
</head>
<body>
  ${item.html}
</body>
</html>`;

    const htmlPath = path.join(TEMP_DIR, `${item.name}.html`);
    const pngPath = path.join(OUTPUT_DIR, item.name);

    fs.writeFileSync(htmlPath, fullHtml, 'utf8');

    const cmd = `google-chrome --headless=new --no-sandbox --disable-gpu --default-background-color=00000000 --screenshot="${pngPath}" --window-size=${item.width},${item.height} "file://${htmlPath}"`;
    try {
      execSync(cmd, { stdio: 'pipe' });
      const stats = fs.statSync(pngPath);
      console.log(`✅ [${item.name}] 生成成功 (${item.width}x${item.height}, ${stats.size} 字节)`);
    } catch (err) {
      console.error(`❌ [${item.name}] 生成失败:`, err.message);
    }
  }

  // 清理临时 html
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  console.log(`\n🎉 全部图表与图标已成功提取并输出到: ${OUTPUT_DIR}`);
}

generateAll();
