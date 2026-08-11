'use strict';
/**
 * Разбор ссылок vless:// (протокол Xray/VLESS, включая REALITY/TLS,
 * транспорты tcp/ws/grpc/http) и сборка исходящего соединения (outbound)
 * для конфигурации Xray-core.
 *
 * Формат ссылки:
 *   vless://<uuid>@<host>:<port>?encryption=none&security=reality&type=tcp
 *           &flow=xtls-rprx-vision&sni=...&fp=chrome&pbk=...&sid=...&spx=...#Remark
 */

const { buildStreamSettings } = require('./xrayStream');

const LINK_RE = /^vless:\/\/([^@]+)@([^:/?#]+):(\d+)\/?(\?[^#]*)?(#.*)?$/i;

function isVlessLink(text) {
  return typeof text === 'string' && /^vless:\/\//i.test(text.trim());
}

function parseVlessLink(rawLink) {
  const link = rawLink.trim();
  const m = LINK_RE.exec(link);
  if (!m) {
    throw new Error('Похоже на vless://, но не удалось разобрать ссылку (проверьте формат).');
  }
  const [, uuid, address, portStr, queryStr, hashStr] = m;
  const params = {};
  if (queryStr) {
    const sp = new URLSearchParams(queryStr);
    for (const [k, v] of sp.entries()) params[k] = v;
  }
  const remark = hashStr ? decodeURIComponent(hashStr.slice(1)) : '';

  return {
    protocol: 'vless',
    uuid: decodeURIComponent(uuid),
    address,
    port: Number(portStr),
    params,
    remark,
    raw: link,
  };
}

/**
 * Полный конфиг Xray-core: локальный SOCKS-inbound (к нему будет
 * подключаться tun2socks) + VLESS outbound + прямой outbound для DNS/лишнего.
 */
function buildXrayConfig(parsed, opts) {
  const socksPort = opts.socksPort;
  const flow = parsed.params.flow || undefined;

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
        protocol: 'vless',
        settings: {
          vnext: [
            {
              address: parsed.address,
              port: parsed.port,
              users: [
                {
                  id: parsed.uuid,
                  encryption: parsed.params.encryption || 'none',
                  flow: flow,
                },
              ],
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

module.exports = { isVlessLink, parseVlessLink, buildXrayConfig };
