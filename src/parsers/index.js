'use strict';
/**
 * Точка входа для добавления профиля: определяет тип вставленного текста
 * (ссылка vless://, обычный wg/awg .conf, или JSON-экспорт Amnezia) и
 * возвращает нормализованный объект профиля, готовый к сохранению.
 */
const vless = require('./vless');
const trojan = require('./trojan');
const wg = require('./wireguard');

function detectAndParse(inputText, suggestedName) {
  const text = (inputText || '').trim();
  if (!text) throw new Error('Пусто — вставьте ссылку vless://, trojan://, ссылку-подписку или конфиг WireGuard/AmneziaWG.');

  if (vless.isVlessLink(text)) {
    const parsed = vless.parseVlessLink(text);
    return {
      type: 'vless',
      name: suggestedName || parsed.remark || `VLESS ${parsed.address}`,
      raw: text,
      summary: {
        address: parsed.address,
        port: parsed.port,
        network: (parsed.params.type || 'tcp'),
        security: (parsed.params.security || 'none'),
      },
    };
  }

  if (trojan.isTrojanLink(text)) {
    const parsed = trojan.parseTrojanLink(text);
    return {
      type: 'trojan',
      name: suggestedName || parsed.remark || `Trojan ${parsed.address}`,
      raw: text,
      summary: {
        address: parsed.address,
        port: parsed.port,
        network: (parsed.params.type || 'tcp'),
        security: (parsed.params.security || 'none'),
      },
    };
  }

  let confText = text;
  let hint = {};
  if (wg.looksLikeJson(text)) {
    const extracted = wg.extractConfFromAmneziaJson(text);
    if (!extracted) {
      throw new Error('Это похоже на JSON, но внутри не найден конфиг WireGuard/AmneziaWG ([Interface]/[Peer]).');
    }
    confText = extracted.conf;
    hint = extracted.hint;
  }

  if (wg.isWireguardConf(confText)) {
    const parsed = wg.parseWireguardConf(confText);
    const host = wg.endpointHost(parsed);
    return {
      type: 'wireguard',
      isAmnezia: parsed.isAmnezia,
      name: suggestedName || hint.name || hint.hostName || `${parsed.isAmnezia ? 'AmneziaWG' : 'WireGuard'} ${host || ''}`.trim(),
      raw: wg.serializeWireguardConf(parsed),
      summary: {
        address: host,
        allowedIPs: parsed.peers[0].AllowedIPs || '',
        amnezia: parsed.isAmnezia,
      },
    };
  }

  throw new Error(
    'Не удалось распознать формат. Поддерживаются: ссылки vless:// и trojan://, ссылка-подписка (http/https), конфиг WireGuard/AmneziaWG (.conf с [Interface]/[Peer]) или JSON-экспорт Amnezia.'
  );
}

module.exports = { detectAndParse };
