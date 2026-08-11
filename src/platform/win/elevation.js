'use strict';
/**
 * TUN-режим, изменение таблицы маршрутизации и установка AmneziaWG требуют
 * прав администратора Windows. Режим PROXY — нет (только локальный
 * SOCKS/HTTP + реестр Internet Settings текущего пользователя), поэтому
 * манифест собранного .exe сознательно НЕ требует администратора
 * (`requestedExecutionLevel: asInvoker`, см. `build.win` в package.json) —
 * приложение запускается сразу, без UAC, и режим PROXY доступен без каких-
 * либо повышений прав.
 *
 * Когда пользователю нужен именно TUN, права запрашиваются по явному клику
 * на кнопку «Перезапустить от администратора» в баннере приложения — она
 * вызывает `relaunchElevated()` ниже (`Start-Process -Verb RunAs`). Это
 * единственное место, где он вызывается: специально НЕ автоматически при
 * старте, чтобы не выскакивал неожиданный UAC-попап поверх уже открытого
 * окна для тех, кому нужен только PROXY.
 */
const { spawn, execFile } = require('child_process');

function isElevated() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
      ],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err) {
          console.error('[elevation] не удалось проверить права администратора:', err.message);
          resolve(false);
          return;
        }
        resolve(String(stdout).trim().toLowerCase() === 'true');
      }
    );
  });
}

/**
 * Перезапускает текущий процесс через UAC-подтверждение. Вызывается ТОЛЬКО
 * по явному действию пользователя (IPC `elevation:relaunch`, кнопка в
 * баннере) — никогда автоматически при старте приложения.
 * Возвращает { ok: true } только если PowerShell реально смог запустить
 * повышенный процесс (пользователь принял UAC) — иначе { ok: false, error }.
 * Важно: НЕ завершает текущий процесс сама — решение о app.quit() остаётся
 * за вызывающим кодом, чтобы при сбое у пользователя не пропадало окно
 * без единого сообщения об ошибке.
 */
function relaunchElevated(app) {
  return new Promise((resolve) => {
    const exe = process.execPath;
    // В dev-режиме process.argv = [electron.exe, '.', ...]. Передавать '.'
    // дальше нельзя: Start-Process по умолчанию использует рабочей папкой
    // каталог самого exe (node_modules/electron/dist), а не корень проекта,
    // и относительный путь "." там ни на что не указывает. Передаём
    // абсолютный путь к проекту явно — это работает независимо от cwd.
    const extraArgs = app.isPackaged ? [] : [app.getAppPath()];
    const escape = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const psCommand = extraArgs.length
      ? `Start-Process -FilePath ${escape(exe)} -ArgumentList ${extraArgs.map(escape).join(',')} -Verb RunAs`
      : `Start-Process -FilePath ${escape(exe)} -Verb RunAs`;

    console.log('[elevation] запрашиваю UAC:', psCommand);

    const child = spawn('powershell.exe', ['-NoProfile', '-Command', psCommand], {
      windowsHide: true,
    });

    let stderr = '';
    child.stderr && child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      console.error('[elevation] не удалось запустить powershell.exe:', err.message);
      resolve({ ok: false, error: err.message });
    });
    child.on('close', (code) => {
      if (code === 0) {
        console.log('[elevation] UAC принят, повышенный процесс запущен.');
        resolve({ ok: true });
      } else {
        const msg = stderr.trim() || `powershell завершился с кодом ${code} (похоже, UAC был отклонён)`;
        console.error('[elevation] запрос UAC не удался:', msg);
        resolve({ ok: false, error: msg });
      }
    });
  });
}

/**
 * Выполнить команду "с нужными правами". На Windows это тривиально: если мы
 * дошли до вызова (main.js уже проверил elevated=true для TUN до входа в
 * tunController.connect), процесс УЖЕ целиком повышен — обёртка не нужна,
 * просто прозрачно выполняем команду и возвращаем stdout.
 */
function runPrivileged(cmd, args, { log, timeoutMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    log && log(`> ${cmd} ${args.join(' ')}`);
    execFile(cmd, args, { windowsHide: true, timeout: timeoutMs, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      if (stdout && log) log(stdout.trim());
      if (stderr && log) log(stderr.trim());
      if (err) {
        if (err.killed || err.signal) {
          reject(new Error(`${cmd} не ответил за ${Math.round(timeoutMs / 1000)}с и был принудительно остановлен.`));
        } else {
          reject(new Error(`${cmd} завершился с ошибкой: ${err.message}`));
        }
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Запустить долгоживущий процесс "с нужными правами" (для TUN-движка
 * tun2socks). На Windows — прямой spawn, процесс уже элевирован целиком.
 */
function spawnPrivileged(cmd, args, opts = {}) {
  return spawn(cmd, args, opts);
}

module.exports = { isElevated, relaunchElevated, runPrivileged, spawnPrivileged };
