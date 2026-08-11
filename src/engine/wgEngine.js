'use strict';
/**
 * Движок для WireGuard / AmneziaWG профилей. Использует официальный
 * тоннельный сервис amneziawg.exe, вшитый прямо в приложение (см.
 * paths.getBundledAmneziaExe() / resources/amneziawg/) — он сам создаёт
 * NT-адаптер, настраивает IP/DNS и маршруты, поэтому здесь не нужна ручная
 * работа с netsh/route, как для VLESS.
 *
 * AmneziaWG обратно совместим с обычным WireGuard-конфигом: если в конфиге
 * нет полей обфускации (Jc/Jmin/...), тоннель поднимается как обычный wg.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const paths = require('../core/paths');
const coreManager = require('../core/coreManager');

function sanitizeTunnelName(name) {
  let slug = (name || 'profile').replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!slug) slug = 'profile';
  if (!/^[A-Za-z]/.test(slug)) slug = 'wg-' + slug;
  return slug.slice(0, 20);
}

function run(exe, args, log) {
  return new Promise((resolve, reject) => {
    log && log(`> "${exe}" ${args.join(' ')}`);
    const child = spawn(exe, args, { windowsHide: true });
    let out = '';
    child.stdout && child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr && child.stderr.on('data', (d) => (out += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (out.trim() && log) log(out.trim());
      if (code === 0) resolve();
      else reject(new Error(`Код завершения ${code}. ${out.trim()}`));
    });
  });
}

class WgEngine {
  constructor() {
    this.activeTunnelName = null;
  }

  get isRunning() {
    return !!this.activeTunnelName;
  }

  async start(profile, { onLog }) {
    const log = (line) => onLog && onLog(line);
    if (this.isRunning) throw new Error('Движок WireGuard/AmneziaWG уже запущен.');

    const exe = coreManager.findAmneziaExe();
    if (!exe) throw new Error('Встроенный amneziawg.exe не найден — похоже, установка приложения повреждена. Переустановите программу.');

    const tunnelName = sanitizeTunnelName(profile.name);
    const confPath = path.join(paths.getRunDir(), `${tunnelName}.conf`);
    fs.writeFileSync(confPath, profile.raw, 'utf8');

    log(`Устанавливаю тоннельный сервис "${tunnelName}"...`);
    await run(exe, ['/installtunnelservice', confPath], log);
    this.activeTunnelName = tunnelName;
    log('Тоннель WireGuard/AmneziaWG поднят.');
  }

  async stop({ onLog } = {}) {
    const log = (line) => onLog && onLog(line);
    if (!this.activeTunnelName) return;
    const exe = coreManager.findAmneziaExe();
    if (exe) {
      try {
        log(`Останавливаю тоннельный сервис "${this.activeTunnelName}"...`);
        await run(exe, ['/uninstalltunnelservice', this.activeTunnelName], log);
      } catch (err) {
        log(`Не удалось корректно остановить сервис: ${err.message}`);
      }
    }
    this.activeTunnelName = null;
  }
}

module.exports = new WgEngine();
