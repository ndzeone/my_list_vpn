'use strict';
/**
 * Лёгкий TCP-пинг (замер времени установки соединения) — для отображения
 * задержки до сервера в карточке профиля, без внешних зависимостей.
 */
const net = require('net');

function pingTcp(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(Date.now() - start));
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));
    socket.connect(port, host);
  });
}

/**
 * Достаёт host:port для пинга из профиля независимо от типа.
 */
function endpointOf(profile) {
  if (profile.type === 'vless') {
    const vless = require('../parsers/vless');
    const parsed = vless.parseVlessLink(profile.raw);
    return { host: parsed.address, port: parsed.port };
  }
  if (profile.type === 'wireguard') {
    const wg = require('../parsers/wireguard');
    const parsed = wg.parseWireguardConf(profile.raw);
    const ep = parsed.peers[0] && parsed.peers[0].Endpoint;
    if (!ep) return null;
    const idx = ep.lastIndexOf(':');
    if (idx === -1) return null;
    return { host: ep.slice(0, idx), port: Number(ep.slice(idx + 1)) };
  }
  return null;
}

async function pingProfile(profile) {
  const ep = endpointOf(profile);
  if (!ep || !ep.host || !ep.port) return null;
  return pingTcp(ep.host, ep.port);
}

module.exports = { pingTcp, pingProfile };
