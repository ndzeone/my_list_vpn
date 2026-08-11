'use strict';
/**
 * Общие настройки приложения: сеть TUN/PROXY (DNS, IP адаптера, порты Xray) и
 * поведение приложения (автозапуск, автоподключение, окно, обновления).
 * Актуальны для vless/trojan-профилей — WireGuard/AmneziaWG берёт свой
 * IP/DNS прямо из .conf и всегда работает только в режиме TUN.
 *
 * В отличие от profiles.json это не секрет и не привязано к аккаунту —
 * файл лежит в userData открытым текстом, одни настройки на приложение.
 */
const fs = require('fs');
const path = require('path');
const paths = require('../core/paths');

const DEFAULTS = Object.freeze({
  // Сеть (VLESS/Trojan через Xray)
  dns1: '1.1.1.1',
  dns2: '1.0.0.1',
  tunIp: '198.18.0.1',
  socksPort: 12345,
  httpPort: 12346,

  // Режим подключения по умолчанию, который стоит выбран в переключателе
  // TUN/PROXY на главном экране при старте приложения.
  defaultMode: 'tun', // 'tun' | 'proxy'
  // В режиме PROXY — автоматически прописывать локальный прокси в системные
  // настройки Windows (реестр Internet Settings), чтобы браузер и большинство
  // программ сразу пошли через него без ручной настройки.
  autoSystemProxy: true,

  // Поведение приложения
  autostart: false, // запуск вместе с Windows
  autoConnectLast: false, // при запуске сразу подключаться к последнему серверу/режиму
  lastProfileId: null,
  lastMode: null,
  closeBehavior: 'tray', // 'tray' | 'exit' — что делает крестик на окне
  startMinimized: false, // не показывать окно при старте (сразу в трей)
  updateIntervalHours: 6, // как часто перепроверять обновления, пока окно открыто
});

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const UPDATE_INTERVAL_OPTIONS = [1, 3, 6, 12, 24];

function file() {
  return path.join(paths.getUserDataDir(), 'network-settings.json');
}

function validate(s) {
  if (!IPV4_RE.test(String(s.dns1 || ''))) throw new Error('DNS 1: некорректный IPv4-адрес.');
  if (s.dns2 && !IPV4_RE.test(String(s.dns2))) throw new Error('DNS 2: некорректный IPv4-адрес.');
  if (!IPV4_RE.test(String(s.tunIp || ''))) throw new Error('IP TUN-адаптера: некорректный IPv4-адрес.');

  const socksPort = Number(s.socksPort);
  if (!Number.isInteger(socksPort) || socksPort < 1024 || socksPort > 65535) {
    throw new Error('Локальный SOCKS-порт должен быть целым числом от 1024 до 65535.');
  }
  const httpPort = Number(s.httpPort);
  if (!Number.isInteger(httpPort) || httpPort < 1024 || httpPort > 65535) {
    throw new Error('Локальный HTTP-порт (режим PROXY) должен быть целым числом от 1024 до 65535.');
  }
  if (socksPort === httpPort) {
    throw new Error('SOCKS- и HTTP-порт не могут совпадать.');
  }
  if (s.defaultMode && !['tun', 'proxy'].includes(s.defaultMode)) {
    throw new Error('Некорректный режим подключения по умолчанию.');
  }
  if (s.closeBehavior && !['tray', 'exit'].includes(s.closeBehavior)) {
    throw new Error('Некорректное поведение окна при закрытии.');
  }
  if (s.updateIntervalHours && !UPDATE_INTERVAL_OPTIONS.includes(Number(s.updateIntervalHours))) {
    throw new Error('Некорректный интервал проверки обновлений.');
  }
}

function load() {
  try {
    const raw = fs.readFileSync(file(), 'utf8');
    const parsed = JSON.parse(raw);
    return Object.assign({}, DEFAULTS, parsed);
  } catch (err) {
    return Object.assign({}, DEFAULTS);
  }
}

function save(patch) {
  const next = Object.assign({}, load(), patch);
  next.socksPort = Number(next.socksPort);
  next.httpPort = Number(next.httpPort);
  if (next.updateIntervalHours) next.updateIntervalHours = Number(next.updateIntervalHours);
  validate(next);
  fs.writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function reset() {
  const next = Object.assign({}, DEFAULTS);
  fs.writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { load, save, reset, DEFAULTS, UPDATE_INTERVAL_OPTIONS };
