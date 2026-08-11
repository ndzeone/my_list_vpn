'use strict';
/**
 * TUN-режим, изменение таблицы маршрутизации и установка AmneziaWG требуют
 * прав администратора Windows. Основной (и единственный "штатный") способ
 * их получить — встроенный в собранный .exe манифест Windows
 * (`requestedExecutionLevel: requireAdministrator`, см. `build.win` в
 * package.json — electron-builder прошивает его в exe через rcedit).
 * Благодаря манифесту UAC-подтверждение показывает сама Windows ДО того,
 * как процесс вообще стартует: приложению для этого не нужно спрашивать
 * ничего самостоятельно, и все дочерние процессы (xray, tun2socks, netsh,
 * msiexec, amneziawg.exe) сразу наследуют повышенные права.
 *
 * В dev-режиме (`npm start` через голый electron.exe) манифест не
 * применяется — там либо запускайте терминал от имени администратора,
 * либо нажмите кнопку «Перезапустить от администратора» в баннере
 * приложения. Эта кнопка — единственное место, где вызывается
 * `relaunchElevated()` ниже: он специально НЕ вызывается автоматически при
 * старте, чтобы не выскакивал неожиданный UAC-попап поверх уже открытого
 * окна — повышение прав всегда инициирует пользователь явным кликом.
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

module.exports = { isElevated, relaunchElevated };
