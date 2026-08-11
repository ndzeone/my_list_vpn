'use strict';
/**
 * Разбор ссылок trojan:// (протокол Trojan поверх Xray-core, включая
 * транспорты tcp/ws/grpc и TLS/без TLS) — используется многими публичными
 * подписками наравне с vless://. Формат ссылки:
 *
 *   trojan://<password>@<host>:<port>?security=tls&type=ws&sni=...#Remark
 *
 * Общая логика streamSettings (TLS/REALITY/ws/grpc/...) вынесена в
 * xrayStream.js и переиспользуется вместе с vless.js.
 */
const { buildStreamSettings } = require('./xrayStream');

const LINK_RE = /^trojan:\/\/([^@]+)@([^:/?#]+):(\d+)\/?(\?[^#]*)?(#.*)?$/i;

function isTrojanLink(text) {
  return typeof text === 'string' && /^trojan:\/\//i.test(text.trim());
}

function parseTrojanLink(rawLink) {
  const link = rawLink.trim();
  const m = LINK_RE.exec(link);
  if (!m) {
    throw new Error('Похоже на trojan://, но не удалось разобрать ссылку (проверьте формат).');
  }
  const [, password, address, portStr, queryStr, hashStr] = m;
  const params = {};
  if (queryStr) {
    const sp = new URLSearchParams(queryStr);
    for (const [k, v] of sp.entries()) params[k] = v;
  }
  const remark = hashStr ? decodeURIComponent(hashStr.slice(1)) : '';

  return {
    protocol: 'trojan',
    password: decodeURIComponent(password),
    address,
    port: Number(portStr),
    params,
    remark,
    raw: link,
  };
}

/**
 * Полный конфиг Xray-core: локальный SOCKS-inbound (к нему подключается
 * tun2socks) + trojan outbound + прямой outbound.
 */
function buildXrayConfig(parsed, opts) {
  const socksPort = opts.socksPort;

  const inbounds = [
    {
      tag: 'socks-in',
      listen: '127.0.0.1',
      port: socksPort,
      protocol: 'socks',
      settings: { auth: 'noauth', udp: true },
      sniffing: { enabled: true, destOverride: ['http', 'tls'] },
    },
  ];
  // HTTP-inbound добавляется только для режима PROXY (opts.httpPort задан) —
  // в TUN-режиме этого не нужно, трафик и так идёт через SOCKS+tun2socks.
  if (opts.httpPort) {
    inbounds.push({
      tag: 'http-in',
      listen: '127.0.0.1',
      port: opts.httpPort,
      protocol: 'http',
      settings: {},
      sniffing: { enabled: true, destOverride: ['http', 'tls'] },
    });
  }

  return {
    log: { loglevel: opts.logLevel || 'warning' },
    inbounds,
    outbounds: [
      {
        tag: 'proxy',
        protocol: 'trojan',
        settings: {
          servers: [
            {
              address: parsed.address,
              port: parsed.port,
              password: parsed.password,
            },
          ],
        },
        streamSettings: buildStreamSettings(parsed.params, parsed.address),
      },
      { tag: 'direct', protocol: 'freedom', settings: {} },
      { tag: 'block', protocol: 'blackhole', settings: {} },
    ],
    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: [{ type: 'field', outboundTag: 'proxy', network: 'tcp,udp' }],
    },
  };
}

module.exports = { isTrojanLink, parseTrojanLink, buildXrayConfig };
