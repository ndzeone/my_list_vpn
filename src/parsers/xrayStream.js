'use strict';
/**
 * Общая сборка streamSettings для Xray-outbound'ов по query-параметрам
 * ссылки (vless:// и trojan:// используют один и тот же набор полей:
 * security/type/sni/host/path/serviceName/...). Вынесено из vless.js, чтобы
 * trojan.js не дублировал ту же логику.
 */
function buildStreamSettings(params, address) {
  const p = params;
  const network = (p.type || 'tcp').toLowerCase();
  const security = (p.security || 'none').toLowerCase();
  const sni = p.sni || p.host || address;

  const stream = { network, security };

  if (security === 'tls') {
    stream.tlsSettings = {
      serverName: sni,
      allowInsecure: p.allowInsecure === '1' || p.allowInsecure === 'true',
      fingerprint: p.fp || 'chrome',
    };
    if (p.alpn) stream.tlsSettings.alpn = p.alpn.split(',').map((s) => s.trim()).filter(Boolean);
  } else if (security === 'reality') {
    stream.realitySettings = {
      serverName: sni,
      fingerprint: p.fp || 'chrome',
      publicKey: p.pbk || '',
      shortId: p.sid || '',
      spiderX: p.spx ? decodeURIComponent(p.spx) : '',
    };
  }

  if (network === 'ws') {
    stream.wsSettings = {
      path: p.path ? decodeURIComponent(p.path) : '/',
      headers: p.host ? { Host: p.host } : {},
    };
  } else if (network === 'grpc') {
    stream.grpcSettings = {
      serviceName: p.serviceName || '',
      multiMode: p.mode === 'multi',
    };
  } else if (network === 'httpupgrade') {
    stream.httpupgradeSettings = {
      path: p.path ? decodeURIComponent(p.path) : '/',
      host: p.host || sni,
    };
  } else if (network === 'tcp' && p.headerType === 'http') {
    stream.tcpSettings = {
      header: {
        type: 'http',
        request: {
          path: [p.path ? decodeURIComponent(p.path) : '/'],
          headers: { Host: [p.host || sni] },
        },
      },
    };
  }

  return stream;
}

module.exports = { buildStreamSettings };
