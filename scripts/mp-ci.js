/**
 * Cosmo 2FA - 微信小程序 Linux 命令行自动化构建、预览与上传工具
 * 基于微信官方 miniprogram-ci 引擎，无需任何 Windows/macOS 图形界面
 */

const fs = require('fs');
const path = require('path');

async function main() {
  const action = process.argv[2] || 'help';

  if (action === 'help' || !['upload', 'preview'].includes(action)) {
    console.log(`
=====================================================
  Cosmo 2FA - 微信小程序 Linux CLI 上传 / 预览工具
=====================================================
用法:
  node scripts/mp-ci.js upload   [version] [desc]  # 上传为体验版/审核版
  node scripts/mp-ci.js preview                     # 生成真机预览二维码

准备工作 (只需一次):
  1. 登录微信公众平台 (mp.weixin.qq.com)
  2. 进入「开发」->「开发管理」->「开发设置」
  3. 找到「小程序代码上传密钥」，点击「生成」并下载保存 key 文件
  4. 将下载的 private.<appid>.key 文件放到本项目根目录即可（脚本会自动识别）
  5. 在微信后台将「小程序代码上传密钥」下方的「IP白名单」关闭（或添加当前服务器 IP）
=====================================================
`);
    return;
  }

  let ci;
  try {
    ci = require('miniprogram-ci');
  } catch (err) {
    console.error('❌ 未检测到 miniprogram-ci，请先在当前目录下运行: npm install --save-dev miniprogram-ci');
    process.exit(1);
  }

  // 1. 自动寻找项目根目录下的 private.*.key 文件
  const rootDir = path.resolve(__dirname, '..');
  const projectPath = path.join(rootDir, 'miniprogram');

  let keyFile = null;
  let appid = process.env.MP_APPID || '';

  const filesInRoot = fs.readdirSync(rootDir);
  for (const file of filesInRoot) {
    const match = file.match(/^private\.(wx[0-9a-zA-Z]+)\.key$/);
    if (match) {
      keyFile = path.join(rootDir, file);
      if (!appid) appid = match[1];
      break;
    }
  }

  // 也可以从 project.config.json 或环境变量补充
  if (!appid) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(projectPath, 'project.config.json'), 'utf8'));
      if (cfg.appid && cfg.appid !== 'touristappid') {
        appid = cfg.appid;
      }
    } catch (e) {}
  }

  if (!keyFile) {
    // 检查是否有自定义路径
    if (process.env.MP_KEY_PATH && fs.existsSync(process.env.MP_KEY_PATH)) {
      keyFile = process.env.MP_KEY_PATH;
    }
  }

  if (!keyFile || !appid || appid === 'touristappid') {
    console.error(`
❌ 未找到有效的上传密钥文件或 AppID！
请前往微信公众平台 (mp.weixin.qq.com) -> 开发设置 -> 下载「小程序代码上传密钥」；
将下载得到的 key 文件（通常命名为 private.wxXXXXXXXX.key）直接丢进项目根目录：
  ${rootDir}/
脚本会自动提取其中的 AppID 并完成连接！
`);
    process.exit(1);
  }

  console.log(`\n🔑 检测到 AppID: ${appid}`);
  console.log(`📁 密钥文件: ${keyFile}`);
  console.log(`📦 小程序源码路径: ${projectPath}\n`);

  const project = new ci.Project({
    appid: appid,
    type: 'miniProgram',
    projectPath: projectPath,
    privateKeyPath: keyFile,
    ignores: ['node_modules/**/*'],
  });

  const compileSettings = {
    es6: true,
    es7: true,
    minify: true,
    codeProtect: false,
    autoPrefixWXSS: true
  };

  // 2. 执行上传 (upload)
  if (action === 'upload') {
    const version = process.argv[3] || '1.0.0';
    const desc = process.argv[4] || `Cosmo 2FA v${version} (Linux CLI Upload)`;

    console.log(`🚀 正在编译并上传版本 [${version}] 至微信小程序后台...`);
    console.log(`📝 版本说明: ${desc}\n`);

    try {
      const uploadResult = await ci.upload({
        project,
        version,
        desc,
        setting: compileSettings,
        onProgressUpdate: (info) => {
          if (info && info.message) {
            console.log(`➜ ${info.message}`);
          }
        },
      });

      console.log('\n=====================================================');
      console.log('🎉 微信小程序上传成功！');
      console.log('👉 请登录微信公众平台 (mp.weixin.qq.com)「版本管理」中查看体验版，并可一键提审发布！');
      console.log('=====================================================\n');
    } catch (err) {
      console.error('\n❌ 上传失败:', err.message);
      if (err.message && err.message.includes('whitelist')) {
        console.error('\n💡 提示: 微信公众平台启用了上传 IP 白名单限制。');
        console.error('请前往 mp.weixin.qq.com ->「开发管理」->「开发设置」-> 关闭上传白名单，或将当前机器 IP 加入白名单。\n');
      }
      process.exit(1);
    }
  }

  // 3. 执行真机预览 (preview)
  if (action === 'preview') {
    const qrDest = path.join(rootDir, 'assets/png/preview-qrcode.png');
    console.log(`📱 正在编译并生成真机预览版二维码...`);

    try {
      const previewResult = await ci.preview({
        project,
        desc: '真机预览测试',
        setting: compileSettings,
        qrcodeFormat: 'image',
        qrcodeOutputDest: qrDest,
        onProgressUpdate: (info) => {
          if (info && info.message) {
            console.log(`➜ ${info.message}`);
          }
        },
      });

      console.log('\n=====================================================');
      console.log('🎉 预览版已生成！');
      console.log(`📸 预览二维码图片已保存至: ${qrDest}`);
      console.log('📲 使用手机微信扫一扫该图片，即可在真机上立即体验 Cosmo 2FA 小程序！');
      console.log('=====================================================\n');
    } catch (err) {
      console.error('\n❌ 预览生成失败:', err.message);
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
