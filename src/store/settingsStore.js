'use strict';
/**
 * Настройки сети TUN: DNS-серверы, IP виртуального адаптера и локальный
 * SOCKS-порт Xray — актуальны только для vless/trojan-профилей (WireGuard/
 * AmneziaWG берёт свой IP/DNS прямо из .conf, здесь их менять не нужно).
 *
 * В отличие от profiles.json это не секрет и не привязано к аккаунту —
 * файл лежит в userData открытым текстом, одни настройки на приложение.
 */
const fs = require('fs');
const path = require('path');
const paths = require('../core/paths');

const DEFAULTS = Object.freeze({
  dns1: '1.1.1.1',
  dns2: '1.0.0.1',
  tunIp: '198.18.0.1',
  socksPort: 12345,
});

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function file() {
  return path.join(paths.getUserDataDir(), 'network-settings.json');
}

function validate(s) {
  if (!IPV4_RE.test(String(s.dns1 || ''))) throw new Error('DNS 1: некорректный IPv4-адрес.');
  if (s.dns2 && !IPV4_RE.test(String(s.dns2))) throw new Error('DNS 2: некорректный IPv4-адрес.');
  if (!IPV4_RE.test(String(s.tunIp || ''))) throw new Error('IP TUN-адаптера: некорректный IPv4-адрес.');
  const port = Number(s.socksPort);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Локальный SOCKS-порт должен быть целым числом от 1024 до 65535.');
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
  validate(next);
  fs.writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function reset() {
  const next = Object.assign({}, DEFAULTS);
  fs.writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { load, save, reset, DEFAULTS };
