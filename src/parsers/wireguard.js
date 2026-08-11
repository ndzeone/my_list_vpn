'use strict';
/**
 * Разбор конфигов WireGuard / AmneziaWG.
 *
 * Поддерживаются:
 *  - обычный .conf в формате INI ([Interface]/[Peer])
 *  - AmneziaWG-конфиг — тот же INI, но с доп. полями обфускации
 *    (Jc, Jmin, Jmax, S1, S2, H1-H4) в секции [Interface]
 *  - экспорт из приложения Amnezia в виде JSON, внутри которого спрятана
 *    обычная wg-ini строка (поле вида "config": "[Interface]\n...")
 *
 * Движок AmneziaWG обратно совместим с обычным WireGuard-конфигом (если
 * Jc/Jmin/... отсутствуют, ведёт себя как стандартный wg), поэтому оба
 * случая обрабатываются одним и тем же движком на этапе подключения.
 */

const AMNEZIA_KEYS = ['jc', 'jmin', 'jmax', 's1', 's2', 'h1', 'h2', 'h3', 'h4', 'i1', 'i2', 'i3', 'i4', 'i5'];

function isWireguardConf(text) {
  return typeof text === 'string' && /\[Interface\]/i.test(text) && /\[Peer\]/i.test(text);
}

function looksLikeJson(text) {
  const t = text.trim();
  return t.startsWith('{') && t.endsWith('}');
}

/**
 * Если это JSON-экспорт Amnezia — рекурсивно ищем строковое поле,
 * похожее на wg-ini конфиг, плюс подсказки об имени сервера/DNS.
 */
function extractConfFromAmneziaJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return null;
  }

  let foundConf = null;
  let hint = {};

  const visit = (node) => {
    if (foundConf) return;
    if (typeof node === 'string') {
      if (/\[Interface\]/i.test(node) && /\[Peer\]/i.test(node)) {
        foundConf = node;
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === 'object') {
      if (typeof node.description === 'string' && !hint.name) hint.name = node.description;
      if (typeof node.hostName === 'string' && !hint.hostName) hint.hostName = node.hostName;
      for (const key of Object.keys(node)) visit(node[key]);
    }
  };
  visit(data);

  if (!foundConf) return null;
  return { conf: foundConf, hint };
}

/**
 * Простой INI-парсер под нужды wg/awg: секции [Interface] и один или
 * несколько [Peer]. Значения-списки (AllowedIPs) сохраняются строкой как есть.
 */
function parseWireguardConf(text) {
  const lines = text.split(/\r?\n/);
  const result = { interface: {}, peers: [] };
  let current = null; // 'interface' | peer object

  for (let rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    if (/^\[Interface\]$/i.test(line)) {
      current = result.interface;
      continue;
    }
    if (/^\[Peer\]$/i.test(line)) {
      current = {};
      result.peers.push(current);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1 || !current) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    current[key] = value;
  }

  if (!result.interface.PrivateKey) {
    throw new Error('В конфиге нет PrivateKey в секции [Interface] — проверьте файл.');
  }
  if (result.peers.length === 0 || !result.peers[0].PublicKey) {
    throw new Error('В конфиге нет секции [Peer] с PublicKey — проверьте файл.');
  }

  const ifaceKeysLower = Object.keys(result.interface).map((k) => k.toLowerCase());
  result.isAmnezia = AMNEZIA_KEYS.some((k) => ifaceKeysLower.includes(k));

  return result;
}

/**
 * Обратная сборка в текст .conf — используется для записи файла, который
 * передаётся amneziawg.exe /installtunnelservice.
 */
function serializeWireguardConf(parsed) {
  const out = [];
  out.push('[Interface]');
  for (const [k, v] of Object.entries(parsed.interface)) {
    out.push(`${k} = ${v}`);
  }
  for (const peer of parsed.peers) {
    out.push('');
    out.push('[Peer]');
    for (const [k, v] of Object.entries(peer)) {
      out.push(`${k} = ${v}`);
    }
  }
  return out.join('\n') + '\n';
}

function endpointHost(parsed) {
  const ep = parsed.peers[0] && parsed.peers[0].Endpoint;
  if (!ep) return null;
  const idx = ep.lastIndexOf(':');
  return idx === -1 ? ep : ep.slice(0, idx);
}

module.exports = {
  isWireguardConf,
  looksLikeJson,
  extractConfFromAmneziaJson,
  parseWireguardConf,
  serializeWireguardConf,
  endpointHost,
};
