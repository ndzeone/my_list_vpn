'use strict';
/**
 * Движок для WireGuard / AmneziaWG профилей. Оркестрирует общую часть
 * (санитизация имени тоннеля, запись .conf во временный файл), а фактический
 * запуск/остановку делегирует платформенному бэкенду:
 *  - Windows: встроенный тоннельный сервис amneziawg.exe
 *    (src/platform/win/wgBackend.js) — сам создаёт NT-адаптер и маршруты.
 *  - Linux: системные wg-quick/awg-quick (src/platform/linux/wgBackend.js) —
 *    через pkexec, т.к. GUI-процесс не рутовый.
 * AmneziaWG обратно совместим с обычным WireGuard-конфигом: если в конфиге
 * нет полей обфускации (Jc/Jmin/...), тоннель поднимается как обычный wg.
 */
const fs = require('fs');
const path = require('path');

const paths = require('../core/paths');
const coreManager = require('../core/coreManager');
const platform = require('../platform');

function sanitizeTunnelName(name) {
  let slug = (name || 'profile').replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!slug) slug = 'profile';
  if (!/^[A-Za-z]/.test(slug)) slug = 'wg-' + slug;
  // Ограничение в 15 символов — не только Windows-удобство, но и жёсткий
  // лимит имени сетевого интерфейса в Linux (IFNAMSIZ), от которого зависит
  // имя, которое wg-quick/awg-quick возьмёт из имени файла конфига.
  return slug.slice(0, 15);
}

class WgEngine {
  constructor() {
    this.activeTunnelName = null;
    this.activeProfile = null;
  }

  get isRunning() {
    return !!this.activeTunnelName;
  }

  async start(profile, { onLog }) {
    const log = (line) => onLog && onLog(line);
    if (this.isRunning) throw new Error('Движок WireGuard/AmneziaWG уже запущен.');

    const tunnelName = sanitizeTunnelName(profile.name);
    const confPath = path.join(paths.getRunDir(), `${tunnelName}.conf`);
    fs.writeFileSync(confPath, profile.raw, 'utf8');

    const amneziaExePath = coreManager.findAmneziaExe(); // null на Linux — win-бэкенд сам проверит
    await platform.wgBackend.start(profile, tunnelName, confPath, { onLog, amneziaExePath });
    this.activeTunnelName = tunnelName;
    this.activeProfile = profile;
  }

  async stop({ onLog } = {}) {
    if (!this.activeTunnelName) return;
    const amneziaExePath = coreManager.findAmneziaExe();
    await platform.wgBackend.stop(this.activeTunnelName, { onLog, amneziaExePath, profile: this.activeProfile });
    this.activeTunnelName = null;
    this.activeProfile = null;
  }
}

module.exports = new WgEngine();
