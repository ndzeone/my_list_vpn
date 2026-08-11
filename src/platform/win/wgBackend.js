'use strict';
/**
 * Windows-часть движка WireGuard/AmneziaWG: официальный тоннельный сервис
 * amneziawg.exe, вшитый прямо в приложение (см. paths.getBundledAmneziaExe()
 * / resources/amneziawg/) — он сам создаёт NT-адаптер, настраивает IP/DNS и
 * маршруты, поэтому здесь не нужна ручная работа с netsh/route, как для
 * VLESS. AmneziaWG обратно совместим с обычным WireGuard-конфигом.
 *
 * Оркестрация (имя тоннеля, запись .conf) остаётся в src/engine/wgEngine.js —
 * этот модуль отвечает только за фактический запуск/остановку сервиса.
 */
const { spawn } = require('child_process');

// См. src/platform/win/routeHelper.js: без таймаута зависший процесс держит
// tunController в состоянии "connecting" навсегда.
const RUN_TIMEOUT_MS = 15000;

function run(exe, args, log, timeoutMs = RUN_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    log && log(`> "${exe}" ${args.join(' ')}`);
    const child = spawn(exe, args, { windowsHide: true });
    let out = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch (err) { /* ignore */ }
      reject(new Error(`"${exe}" не ответил за ${Math.round(timeoutMs / 1000)}с и был принудительно остановлен.`));
    }, timeoutMs);
    child.stdout && child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr && child.stderr.on('data', (d) => (out += d.toString()));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (out.trim() && log) log(out.trim());
      if (code === 0) resolve();
      else reject(new Error(`Код завершения ${code}. ${out.trim()}`));
    });
  });
}

/**
 * @param {object} profile — профиль (не используется напрямую, для интерфейса)
 * @param {string} tunnelName — санитизированное имя тоннеля
 * @param {string} confPath — путь к записанному .conf
 * @param {{onLog:Function, amneziaExePath:string}} opts — amneziaExePath ищет
 *   вызывающий код (coreManager.findAmneziaExe()), чтобы этот модуль не
 *   зависел от core/coreManager.js напрямую (там своя цепочка require).
 */
async function start(profile, tunnelName, confPath, { onLog, amneziaExePath }) {
  const log = (line) => onLog && onLog(line);
  if (!amneziaExePath) {
    throw new Error('Встроенный amneziawg.exe не найден — похоже, установка приложения повреждена. Переустановите программу.');
  }
  log(`Устанавливаю тоннельный сервис "${tunnelName}"...`);
  await run(amneziaExePath, ['/installtunnelservice', confPath], log);
  log('Тоннель WireGuard/AmneziaWG поднят.');
}

async function stop(tunnelName, { onLog, amneziaExePath }) {
  const log = (line) => onLog && onLog(line);
  if (!amneziaExePath) return;
  try {
    log(`Останавливаю тоннельный сервис "${tunnelName}"...`);
    await run(amneziaExePath, ['/uninstalltunnelservice', tunnelName], log);
  } catch (err) {
    log(`Не удалось корректно остановить сервис: ${err.message}`);
  }
}

module.exports = { start, stop };
