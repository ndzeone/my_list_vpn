'use strict';
/**
 * Вспомогательные функции для настройки маршрутизации Windows вокруг TUN-
 * адаптера, который поднимает tun2socks (используется только для VLESS/Xray;
 * WireGuard/AmneziaWG настраивает свою маршрутизацию сам через тоннельный
 * сервис). Все команды выполняются через встроенные netsh/route/PowerShell —
 * никаких дополнительных системных утилит не требуется.
 */
const dns = require('dns').promises;
const { execFile } = require('child_process');

const TUN_NAME = 'MyListVPN';
const TUN_IP = '198.18.0.1';
const TUN_MASK = '255.255.255.0';

function run(cmd, args, log) {
  return new Promise((resolve, reject) => {
    log && log(`> ${cmd} ${args.join(' ')}`);
    execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) => {
      if (stdout && log) log(stdout.trim());
      if (stderr && log) log(stderr.trim());
      if (err) reject(new Error(`${cmd} завершился с ошибкой: ${err.message}`));
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
  const psScript =
    '(Get-NetRoute -DestinationPrefix 0.0.0.0/0 -AddressFamily IPv4 | ' +
    'Sort-Object -Property RouteMetric | Select-Object -First 1 | ' +
    'ForEach-Object { "$($_.NextHop)|$($_.InterfaceIndex)" })';
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], log);
  const [gateway, ifIndex] = out.trim().split('|');
  if (!gateway || !ifIndex) throw new Error('Не удалось определить основной шлюз по умолчанию.');
  return { gateway, ifIndex: Number(ifIndex) };
}

async function getAdapterIndex(name, log, retries = 20, delayMs = 500) {
  const psScript = `(Get-NetAdapter -Name '${name}' -ErrorAction SilentlyContinue | Select-Object -Expand ifIndex)`;
  for (let i = 0; i < retries; i++) {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], log);
    const idx = parseInt(out.trim(), 10);
    if (!Number.isNaN(idx)) return idx;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Адаптер "${name}" не появился в системе (tun2socks не запустился?).`);
}

async function configureTunAdapter(log, dnsServers = ['1.1.1.1', '1.0.0.1'], tunIp = TUN_IP) {
  const ifIndex = await getAdapterIndex(TUN_NAME, log);
  await run('netsh', ['interface', 'ipv4', 'set', 'address', `name="${TUN_NAME}"`, 'static', tunIp, TUN_MASK], log);
  await run(
    'netsh',
    ['interface', 'ipv4', 'set', 'dnsservers', `name="${TUN_NAME}"`, 'static', dnsServers[0], 'primary'],
    log
  );
  for (let i = 1; i < dnsServers.length; i++) {
    await run(
      'netsh',
      ['interface', 'ipv4', 'add', 'dnsservers', `name="${TUN_NAME}"`, dnsServers[i], `index=${i + 1}`],
      log
    );
  }
  return ifIndex;
}

async function addBypassRoute(serverIp, gateway, ifIndex, log) {
  await run('route', ['add', serverIp, 'mask', '255.255.255.255', gateway, 'metric', '5', 'if', String(ifIndex)], log);
}

async function removeBypassRoute(serverIp, log) {
  try {
    await run('route', ['delete', serverIp], log);
  } catch (err) {
    log && log(`(не критично) не удалось убрать обходной маршрут: ${err.message}`);
  }
}

async function setDefaultRouteViaTun(tunIfIndex, log, tunIp = TUN_IP) {
  await run('route', ['add', '0.0.0.0', 'mask', '0.0.0.0', tunIp, 'metric', '1', 'if', String(tunIfIndex)], log);
}

async function clearDefaultRouteViaTun(log, tunIp = TUN_IP) {
  try {
    await run('route', ['delete', '0.0.0.0', 'mask', '0.0.0.0', tunIp], log);
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
