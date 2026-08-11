'use strict';
/**
 * Включение/выключение системного прокси Windows (per-user Internet Settings)
 * для режима PROXY: в отличие от TUN здесь не создаётся сетевой адаптер и не
 * трогается таблица маршрутизации (и поэтому не нужны права администратора) —
 * просто прописывается адрес локального HTTP/SOCKS-прокси Xray в реестр,
 * который читают браузеры и большинство приложений через WinINet.
 *
 * Предыдущее значение сохраняется в памяти процесса и восстанавливается при
 * отключении — так что если до подключения у пользователя уже был настроен
 * свой прокси, мы его не затираем навсегда.
 */
const { execFile } = require('child_process');

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

// Применить изменения реестра сразу, без перелогина — стандартный P/Invoke
// вызов InternetSetOption(NULL, INTERNET_OPTION_SETTINGS_CHANGED/REFRESH, ...).
const REFRESH_PS = [
  '$sig = \'[DllImport("wininet.dll", SetLastError = true, CharSet=CharSet.Auto)] public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);\';',
  '$t = Add-Type -MemberDefinition $sig -Name WinInetOptions -Namespace MyListVpn -PassThru;',
  '$t::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null;',
  '$t::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null;',
].join(' ');

function run(cmd, args, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} завершился с ошибкой: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

async function refreshSystem(log) {
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', REFRESH_PS]);
  } catch (err) {
    log && log(`(не критично) не удалось разослать обновление настроек прокси: ${err.message}`);
  }
}

async function readCurrentProxy(log) {
  try {
    const out = await run('reg', ['query', REG_KEY]);
    const enabledMatch = out.match(/ProxyEnable\s+REG_DWORD\s+0x([0-9a-fA-F]+)/);
    const serverMatch = out.match(/ProxyServer\s+REG_SZ\s+(\S+)/);
    return {
      enable: enabledMatch ? parseInt(enabledMatch[1], 16) : 0,
      server: serverMatch ? serverMatch[1] : '',
    };
  } catch (err) {
    log && log(`(не критично) не удалось прочитать текущий системный прокси: ${err.message}`);
    return { enable: 0, server: '' };
  }
}

let savedState = null;

async function enableSystemProxy(httpPort, socksPort, { onLog } = {}) {
  const log = (line) => onLog && onLog(line);
  savedState = await readCurrentProxy(log);

  const server = `http=127.0.0.1:${httpPort};https=127.0.0.1:${httpPort};socks=127.0.0.1:${socksPort}`;
  log(`Включаю системный прокси Windows: ${server}`);
  await run('reg', ['add', REG_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f']);
  await run('reg', ['add', REG_KEY, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', server, '/f']);
  // Локальные адреса/loopback не должны идти через прокси.
  await run('reg', ['add', REG_KEY, '/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', '<local>', '/f']);
  await refreshSystem(log);
}

async function disableSystemProxy({ onLog } = {}) {
  const log = (line) => onLog && onLog(line);
  const restore = savedState || { enable: 0, server: '' };
  savedState = null;

  log('Восстанавливаю прежний системный прокси Windows...');
  await run('reg', ['add', REG_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', String(restore.enable), '/f']);
  if (restore.server) {
    await run('reg', ['add', REG_KEY, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', restore.server, '/f']);
  } else {
    await run('reg', ['delete', REG_KEY, '/v', 'ProxyServer', '/f']).catch(() => {});
  }
  await refreshSystem(log);
}

module.exports = { enableSystemProxy, disableSystemProxy };
