'use strict';
/**
 * Модель прав на Linux принципиально другая, чем Windows-UAC: GUI-процесс
 * НИКОГДА не запускается целиком от root (это плохая практика для
 * Electron-приложений на Linux). Вместо этого privileged-операции (создание
 * TUN-адаптера, правка маршрутов/DNS, wg-quick/awg-quick) оборачиваются в
 * `pkexec` по отдельности — PolicyKit сам показывает графический запрос
 * пароля именно на ту команду, которая его требует. Режим PROXY вообще не
 * доходит до этого кода — работает как обычный процесс без каких-либо прав.
 *
 * Поэтому "isElevated" здесь не про факт запуска от root, а про то, что
 * приложению в принципе доступны привилегированные операции через pkexec —
 * то есть всегда true: баннер "нужны права администратора" и кнопка
 * "перезапустить от администратора" (Windows-специфичный UAC-флоу) на Linux
 * просто не нужны и не показываются.
 */
const { spawn, execFile } = require('child_process');

function isElevated() {
  return Promise.resolve(true);
}

function relaunchElevated() {
  // Не используется в UI-потоке на Linux (кнопка скрыта, т.к. isElevated()
  // всегда true) — оставлено для паритета интерфейса с Windows-модулем.
  return Promise.resolve({ ok: false, error: 'На Linux права запрашиваются точечно через pkexec, перезапуск всего процесса не требуется.' });
}

/**
 * Разовая привилегированная команда (ip route, resolvectl, wg-quick, ...).
 * pkexec сам показывает системный графический запрос пароля/отпечатка —
 * никакого пароля в коде мы не храним и не запрашиваем сами.
 */
function runPrivileged(cmd, args, { log, timeoutMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const full = ['pkexec', cmd, ...args];
    log && log(`> ${full.join(' ')}`);
    execFile('pkexec', [cmd, ...args], { timeout: timeoutMs, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      if (stdout && log) log(stdout.trim());
      if (stderr && log) log(stderr.trim());
      if (err) {
        if (err.killed || err.signal) {
          reject(new Error(`${cmd} не ответил за ${Math.round(timeoutMs / 1000)}с и был принудительно остановлен.`));
        } else if (err.code === 126 || err.code === 127) {
          reject(new Error(`Запрос прав через pkexec отклонён или отменён (${cmd}).`));
        } else {
          reject(new Error(`${cmd} завершился с ошибкой: ${(stderr || err.message).trim()}`));
        }
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Долгоживущий привилегированный процесс (tun2socks для TUN-режима — ему
 * нужен доступ к /dev/net/tun). Возвращает обычный ChildProcess: pkexec
 * заменяет себя выполняемой командой (как sudo), поэтому child.kill()
 * корректно останавливает именно целевой процесс, а не только pkexec.
 */
function spawnPrivileged(cmd, args, opts = {}) {
  return spawn('pkexec', [cmd, ...args], opts);
}

module.exports = { isElevated, relaunchElevated, runPrivileged, spawnPrivileged };
