'use strict';
/**
 * Настройка маршрутизации Linux вокруг TUN-адаптера, который поднимает
 * tun2socks (используется только для VLESS/Trojan/Xray; WireGuard/AmneziaWG
 * настраивает свою маршрутизацию сам через wg-quick/awg-quick — см.
 * ../linux/wgBackend.js). Интерфейс функций один в один с
 * ../win/routeHelper.js, чтобы xrayEngine.js вообще не знал о платформе.
 *
 * Мутирующие команды (ip route/addr/link, resolvectl) требуют root — идут
 * через elevation.runPrivileged() (pkexec на каждую команду отдельно, см.
 * ./elevation.js). Само чтение состояния сети (текущий шлюз) прав не
 * требует — выполняется напрямую.
 */
const dns = require('dns').promises;
const { execFile } = require('child_process');
const elevation = require('./elevation');

const TUN_NAME = 'mylistvpn0';
const TUN_IP = '198.18.0.1';
const TUN_PREFIX = 24;

function runUnprivileged(cmd, args, log, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    log && log(`> ${cmd} ${args.join(' ')}`);
    execFile(cmd, args, { timeout: timeoutMs, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      if (stdout && log) log(stdout.trim());
      if (err) reject(new Error(`${cmd} завершился с ошибкой: ${(stderr || err.message).trim()}`));
      else resolve(stdout);
    });
  });
}

async function resolveHost(host) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
  const { address } = await dns.lookup(host, { family: 4 });
  return address;
}

async function getDefaultGateway(log) {
  // "ip route show default" -> "default via 192.168.1.1 dev wlan0 proto ... metric 600"
  const out = await runUnprivileged('ip', ['route', 'show', 'default'], log);
  const firstLine = out.split('\n')[0] || '';
  const viaMatch = firstLine.match(/via\s+(\S+)/);
  const devMatch = firstLine.match(/dev\s+(\S+)/);
  if (!viaMatch || !devMatch) {
    throw new Error('Не удалось определить основной шлюз по умолчанию (нет маршрута default через "ip route").');
  }
  // ifIndex здесь хранит ИМЯ интерфейса (строка), а не числовой индекс — на
  // Linux все команды ip/pkexec адресуются по имени. xrayEngine.js передаёт
  // это значение дальше не интерпретируя, так что несовпадение типа с
  // Windows-веткой (там число) безопасно.
  return { gateway: viaMatch[1], ifIndex: devMatch[1] };
}

async function waitForLink(name, log, retries = 20, delayMs = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      await runUnprivileged('ip', ['link', 'show', name], null, 4000);
      return;
    } catch (err) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(`Адаптер "${name}" не появился в системе (tun2socks не запустился? нужны права через pkexec).`);
}

async function configureTunAdapter(log, dnsServers = ['1.1.1.1', '1.0.0.1'], tunIp = TUN_IP) {
  await waitForLink(TUN_NAME, log);
  await elevation.runPrivileged('ip', ['addr', 'add', `${tunIp}/${TUN_PREFIX}`, 'dev', TUN_NAME], { log });
  await elevation.runPrivileged('ip', ['link', 'set', 'dev', TUN_NAME, 'up'], { log });
  // systemd-resolved (по умолчанию на Fedora) — делаем TUN-адаптер основным
  // резолвером на время соединения (~. = маршрут для всех доменов).
  try {
    await elevation.runPrivileged('resolvectl', ['dns', TUN_NAME, ...dnsServers], { log });
    await elevation.runPrivileged('resolvectl', ['domain', TUN_NAME, '~.'], { log });
  } catch (err) {
    log && log(`(не критично) не удалось настроить DNS через resolvectl — возможно, systemd-resolved не используется: ${err.message}`);
  }
  return TUN_NAME;
}

async function addBypassRoute(serverIp, gateway, ifName, log) {
  await elevation.runPrivileged('ip', ['route', 'add', `${serverIp}/32`, 'via', gateway, 'dev', String(ifName), 'metric', '5'], { log });
}

async function removeBypassRoute(serverIp, log) {
  try {
    await elevation.runPrivileged('ip', ['route', 'del', `${serverIp}/32`], { log });
  } catch (err) {
    log && log(`(не критично) не удалось убрать обходной маршрут: ${err.message}`);
  }
}

async function setDefaultRouteViaTun(tunIfName, log, tunIp = TUN_IP) {
  await elevation.runPrivileged('ip', ['route', 'add', 'default', 'via', tunIp, 'dev', String(tunIfName), 'metric', '1'], { log });
}

async function clearDefaultRouteViaTun(log, tunIp = TUN_IP) {
  try {
    await elevation.runPrivileged('ip', ['route', 'del', 'default', 'via', tunIp], { log });
  } catch (err) {
    log && log(`(не критично) не удалось убрать маршрут по умолчанию: ${err.message}`);
  }
}

module.exports = {
  TUN_NAME,
  TUN_IP,
  resolveHost,
  getDefaultGateway,
  configureTunAdapter,
  addBypassRoute,
  removeBypassRoute,
  setDefaultRouteViaTun,
  clearDefaultRouteViaTun,
};
