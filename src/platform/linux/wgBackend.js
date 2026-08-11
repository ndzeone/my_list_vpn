'use strict';
/**
 * Linux-часть движка WireGuard/AmneziaWG. В отличие от Windows здесь нет
 * вшитого бинарника — используются штатные утилиты из системы:
 *  - `wg-quick` (пакет wireguard-tools, есть в стандартных репозиториях
 *    Fedora) — для обычных WireGuard-конфигов;
 *  - `awg-quick` (пакет amneziawg-tools, ставится отдельно из COPR — см.
 *    README) — для конфигов с полями обфускации Jc/Jmin/... (см.
 *    profile.isAmnezia, определяется в src/parsers/wireguard.js).
 * Обе команды сами создают интерфейс, настраивают IP/DNS/маршруты и требуют
 * root — выполняются через elevation.runPrivileged() (pkexec).
 */
const elevation = require('./elevation');

function backendBinary(profile) {
  return profile && profile.isAmnezia ? 'awg-quick' : 'wg-quick';
}

async function start(profile, tunnelName, confPath, { onLog }) {
  const log = (line) => onLog && onLog(line);
  const bin = backendBinary(profile);
  log(`Поднимаю интерфейс "${tunnelName}" через ${bin} (конфиг ${confPath})...`);
  try {
    await elevation.runPrivileged(bin, ['up', confPath], { log, timeoutMs: 15000 });
  } catch (err) {
    if (bin === 'awg-quick' && /not found|ENOENT|command/i.test(err.message)) {
      throw new Error(
        `${err.message} Похоже, не установлен amneziawg-tools — для конфигов AmneziaWG с обфускацией на Fedora нужно ` +
          'подключить COPR-репозиторий и поставить amneziawg-tools (см. README, раздел «Установка на Fedora»).'
      );
    }
    throw err;
  }
  log('Тоннель WireGuard/AmneziaWG поднят.');
}

async function stop(tunnelName, { onLog, profile }) {
  const log = (line) => onLog && onLog(line);
  const bin = backendBinary(profile);
  try {
    log(`Останавливаю интерфейс "${tunnelName}" через ${bin}...`);
    // "down" принимает как путь к конфигу, так и просто имя интерфейса —
    // имени достаточно, конфиг-файл к этому моменту мог быть уже удалён.
    await elevation.runPrivileged(bin, ['down', tunnelName], { log, timeoutMs: 15000 });
  } catch (err) {
    log(`Не удалось корректно остановить интерфейс: ${err.message}`);
  }
}

module.exports = { start, stop };
