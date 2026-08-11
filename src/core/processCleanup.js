'use strict';
/**
 * Подчищает "зомби"-процессы xray.exe/tun2socks.exe, оставшиеся от прошлого
 * краша приложения или аварийного завершения Windows: если такой процесс
 * держит наш SOCKS-порт или TUN-адаптер, следующая попытка подключения может
 * зависнуть навсегда (см. таймауты в routeHelper.js/wgEngine.js — они лечат
 * симптом, а это лечит причину). Останавливаем ТОЛЬКО процессы, запущенные из
 * нашего собственного userData/core — чужой xray.exe/tun2socks.exe на машине
 * пользователя не трогаем.
 */
const { execFile } = require('child_process');
const paths = require('./paths');

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      // Best-effort: любая ошибка здесь не должна мешать запуску приложения.
      resolve(err ? '' : stdout);
    });
  });
}

async function killOwnedZombiesWin(onLog) {
  const log = (line) => onLog && onLog(line);
  const coreDir = paths.getCoreDir().replace(/\\/g, '\\\\');
  const psScript =
    `Get-CimInstance Win32_Process -Filter "Name='xray.exe' OR Name='tun2socks.exe'" | ` +
    `Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like '${coreDir}*' } | ` +
    `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }`;
  try {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript]);
    const pids = out.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    if (pids.length) log(`Остановлены зависшие процессы от прошлого запуска: PID ${pids.join(', ')}.`);
  } catch (err) {
    // Не критично — просто продолжаем запуск.
  }
}

/**
 * На Linux то же самое best-effort, но с оговоркой: xray в режиме PROXY —
 * обычный процесс текущего пользователя, его можно остановить сигналом
 * напрямую. tun2socks для TUN, наоборот, обычно запущен через pkexec (root) —
 * убить его без пароля нельзя, а спрашивать pkexec на каждый старт
 * приложения "просто на всякий случай" — хуже той проблемы, что лечим,
 * поэтому для него это лучшее, что можно сделать без обращения к root.
 */
async function killOwnedZombiesLinux(onLog) {
  const log = (line) => onLog && onLog(line);
  const coreDir = paths.getCoreDir();
  try {
    const out = await run('pgrep', ['-f', coreDir]);
    const pids = out.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGKILL');
        log(`Остановлен зависший процесс от прошлого запуска: PID ${pid}.`);
      } catch (err) {
        // Скорее всего, процесс от прошлого TUN-подключения запущен через
        // pkexec (root) — обычным SIGKILL от имени пользователя не убить.
      }
    }
  } catch (err) {
    // pgrep ничего не нашёл или недоступен — не критично.
  }
}

function killOwnedZombies(onLog) {
  return process.platform === 'win32' ? killOwnedZombiesWin(onLog) : killOwnedZombiesLinux(onLog);
}

module.exports = { killOwnedZombies };
