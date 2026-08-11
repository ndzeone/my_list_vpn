'use strict';
/**
 * Движок для vless:// и trojan:// профилей (Xray-core). Поддерживает два
 * независимых режима подключения:
 *
 *  - TUN (startTun):   Xray отдаёт локальный SOCKS5, tun2socks поверх wintun
 *                       (Windows) или /dev/net/tun (Linux) превращает его в
 *                       системный TUN-адаптер — весь трафик ОС идёт через
 *                       это соединение. Требует прав администратора/root
 *                       (создание адаптера, правка маршрутов) — на Windows
 *                       через UAC заранее, на Linux — через pkexec точечно
 *                       на сам процесс tun2socks (см. src/platform).
 *  - PROXY (startProxy): Xray поднимает локальный SOCKS5 И HTTP-прокси,
 *                       больше ничего не трогается — ни TUN-адаптера, ни
 *                       таблицы маршрутизации. Прав администратора/root не
 *                       нужно вообще. tunController дополнительно пытается
 *                       прописать эти порты в системный прокси через
 *                       proxyManager (на Windows реально включает, на Linux
 *                       только показывает адрес — см. src/platform).
 *
 * Протоколы (vless/trojan) отличаются только разбором ссылки и формой
 * outbound'а в конфиге Xray — сама обвязка одна для обоих режимов.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const paths = require('../core/paths');
const vless = require('../parsers/vless');
const trojan = require('../parsers/trojan');
const platform = require('../platform');
const route = platform.routeHelper;
const settingsStore = require('../store/settingsStore');

const LINK_KINDS = {
  vless: { parse: vless.parseVlessLink, buildConfig: vless.buildXrayConfig },
  trojan: { parse: trojan.parseTrojanLink, buildConfig: trojan.buildXrayConfig },
};

class XrayEngine {
  constructor() {
    this.xrayProc = null;
    this.tunProc = null;
    this.bypassIp = null;
    this.tunIfIndex = null;
    this.mode = null; // 'tun' | 'proxy'
    // IP TUN-адаптера, реально применённый при подключении — фиксируем на
    // время сессии, чтобы отключение чистило маршрут тем же IP, даже если
    // пользователь поменяет настройки сети, пока туннель активен.
    this.activeTunIp = null;
  }

  get isRunning() {
    return !!this.tunProc || !!this.xrayProc;
  }

  _writeConfigAndSpawnXray(profile, net, extraOpts, log) {
    const kind = LINK_KINDS[profile.type];
    if (!kind) throw new Error(`Неизвестный тип профиля для Xray-движка: ${profile.type}`);

    const parsed = kind.parse(profile.raw);
    const config = kind.buildConfig(parsed, Object.assign({ socksPort: net.socksPort, logLevel: 'warning' }, extraOpts));
    const configPath = path.join(paths.getRunDir(), 'xray-config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    log('Запускаю xray-core...');
    this.xrayProc = spawn(paths.getXrayExe(), ['-c', configPath], {
      cwd: paths.getXrayDir(),
      windowsHide: true,
    });
    this._pipeLogs(this.xrayProc, 'xray', log);
    this.xrayProc.on('exit', (code) => {
      log(`xray-core завершился (код ${code}).`);
      this.xrayProc = null;
    });

    return parsed;
  }

  async startTun(profile, { onLog }) {
    const log = (line) => onLog && onLog(line);
    if (this.isRunning) throw new Error('Движок Xray (VLESS/Trojan) уже запущен.');
    this.mode = 'tun';

    const net = settingsStore.load();
    this.activeTunIp = net.tunIp;

    const parsed = this._writeConfigAndSpawnXray(profile, net, {}, log);

    log(`Разрешаю адрес сервера ${parsed.address}...`);
    const serverIp = await route.resolveHost(parsed.address);
    log(`Сервер: ${parsed.address} -> ${serverIp}`);

    // Даём xray время поднять локальный SOCKS перед тем, как на него пойдёт tun2socks.
    await new Promise((r) => setTimeout(r, 700));

    log('Определяю текущий шлюз по умолчанию (для обходного маршрута к серверу)...');
    const { gateway, ifIndex: physicalIfIndex } = await route.getDefaultGateway(log);
    await route.addBypassRoute(serverIp, gateway, physicalIfIndex, log);
    this.bypassIp = serverIp;

    // Создание TUN-адаптера требует прав администратора/root. На Windows
    // spawnPrivileged — прозрачный spawn (процесс уже целиком элевирован,
    // см. platform/win/elevation.js); на Linux — обёртка через pkexec
    // (platform/linux/elevation.js), т.к. GUI-процесс тут НЕ рутовый.
    log('Запускаю tun2socks (создание TUN-адаптера)...');
    this.tunProc = platform.elevation.spawnPrivileged(
      paths.getTun2socksExe(),
      ['-device', `tun://${route.TUN_NAME}`, '-proxy', `socks5://127.0.0.1:${net.socksPort}`, '-loglevel', 'info'],
      { cwd: paths.getTun2socksDir(), windowsHide: true }
    );
    this._pipeLogs(this.tunProc, 'tun2socks', log);
    this.tunProc.on('exit', (code) => {
      log(`tun2socks завершился (код ${code}).`);
      this.tunProc = null;
    });

    log(`Настраиваю IP/DNS адаптера (${net.tunIp}, DNS ${net.dns1}${net.dns2 ? ', ' + net.dns2 : ''})...`);
    this.tunIfIndex = await route.configureTunAdapter(log, [net.dns1, net.dns2].filter(Boolean), net.tunIp);

    log('Направляю системный трафик через TUN...');
    await route.setDefaultRouteViaTun(this.tunIfIndex, log, net.tunIp);

    log('VLESS/Trojan-туннель (TUN) поднят.');
  }

  /**
   * Режим PROXY: только локальный SOCKS+HTTP, без TUN-адаптера и без правки
   * маршрутов. Не требует прав администратора. Системный прокси Windows
   * включает вызывающая сторона (tunController) через proxyManager — здесь
   * только сам Xray.
   */
  async startProxy(profile, { onLog }) {
    const log = (line) => onLog && onLog(line);
    if (this.isRunning) throw new Error('Движок Xray (VLESS/Trojan) уже запущен.');
    this.mode = 'proxy';

    const net = settingsStore.load();
    this._writeConfigAndSpawnXray(profile, net, { httpPort: net.httpPort }, log);

    // Даём xray время поднять локальные inbound'ы.
    await new Promise((r) => setTimeout(r, 500));
    if (!this.xrayProc) {
      throw new Error('xray-core не запустился (завершился сразу после старта) — смотрите журнал соединения.');
    }

    log(`Локальный прокси поднят: SOCKS5 127.0.0.1:${net.socksPort}, HTTP 127.0.0.1:${net.httpPort}.`);
  }

  async stop({ onLog } = {}) {
    const log = (line) => onLog && onLog(line);
    if (this.mode === 'tun') {
      await route.clearDefaultRouteViaTun(log, this.activeTunIp || undefined);
      if (this.bypassIp) {
        await route.removeBypassRoute(this.bypassIp, log);
        this.bypassIp = null;
      }
      this._kill(this.tunProc, 'tun2socks', log);
    }
    this._kill(this.xrayProc, 'xray-core', log);
    this.tunProc = null;
    this.xrayProc = null;
    this.tunIfIndex = null;
    this.activeTunIp = null;
    this.mode = null;
  }

  _kill(proc, name, log) {
    if (!proc) return;
    try {
      proc.kill();
      log && log(`${name} остановлен.`);
    } catch (err) {
      log && log(`Не удалось остановить ${name}: ${err.message}`);
    }
  }

  _pipeLogs(proc, tag, log) {
    proc.stdout && proc.stdout.on('data', (d) => log(`[${tag}] ${d.toString().trim()}`));
    proc.stderr && proc.stderr.on('data', (d) => log(`[${tag}] ${d.toString().trim()}`));
    proc.on('error', (err) => log(`[${tag}] ошибка запуска: ${err.message}`));
  }
}

module.exports = new XrayEngine();
