'use strict';
/**
 * Импорт по ссылке-подписке (http/https), а не по одиночному vless/trojan.
 * Многие панели (в т.ч. StealthSurf и другие на базе 3x-ui/Marzban) отдают
 * по такой ссылке не сам конфиг напрямую, а:
 *   - одну или несколько строк vless://.../trojan://... построчно, либо
 *   - тот же список, но целиком закодированный в base64 (классический
 *     формат подписок v2rayN/Xray) —
 * и сопровождают ответ служебными заголовками (`profile-title`,
 * `subscription-userinfo` с трафиком/сроком и т.д., см. спецификацию
 * "Shadowrocket/V2rayN subscription userinfo").
 *
 * Модуль только скачивает и раскладывает ссылку на отдельные строки-конфиги
 * — сам разбор каждой строки делает parsers/index.js (detectAndParse), это
 * и делает подписку из любых WireGuard/vless/trojan строк, без дублирования
 * логики парсинга.
 */
const https = require('https');
const http = require('http');

const { detectAndParse } = require('../parsers');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MyListVPN/1.0';
const SCHEME_RE = /(vless|trojan|vmess|ss):\/\//i;

function httpGetText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('Слишком много перенаправлений при загрузке подписки.'));
      return;
    }
    let target;
    try {
      target = new URL(url);
    } catch (err) {
      reject(new Error('Некорректная ссылка подписки.'));
      return;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      reject(new Error('Ссылка подписки должна начинаться с http:// или https://'));
      return;
    }
    const transport = target.protocol === 'http:' ? http : https;
    const req = transport.get(
      target,
      { headers: { 'User-Agent': UA, Accept: '*/*' }, timeout: 15000 },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const nextUrl = new URL(res.headers.location, target).toString();
          httpGetText(nextUrl, redirects + 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Сервер подписки ответил ${res.statusCode}.`));
          res.resume();
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ body, headers: res.headers }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('Таймаут при загрузке подписки.')));
    req.on('error', reject);
  });
}

function decodeHeaderTitle(raw) {
  if (!raw) return null;
  const m = /^base64:(.+)$/i.exec(String(raw).trim());
  try {
    return Buffer.from(m ? m[1] : raw, 'base64').toString('utf8');
  } catch (err) {
    return null;
  }
}

function tryBase64Decode(text) {
  const compact = text.replace(/\s+/g, '');
  if (!compact || compact.length % 4 === 1 || !/^[A-Za-z0-9+/_-]+=*$/.test(compact)) return null;
  try {
    const normalized = compact.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(normalized, 'base64').toString('utf8');
    return SCHEME_RE.test(decoded) ? decoded : null;
  } catch (err) {
    return null;
  }
}

/**
 * Разбирает тело ответа подписки на отдельные строки-конфиги. Если сам
 * ответ уже содержит распознаваемые ссылки построчно — использует его как
 * есть, иначе пробует раскодировать как base64-блок.
 */
function extractCandidateLines(rawBody) {
  let text = (rawBody || '').trim();
  if (!SCHEME_RE.test(text)) {
    const decoded = tryBase64Decode(text);
    if (decoded) text = decoded;
  }
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function fetchSubscription(url) {
  const { body, headers } = await httpGetText(url);
  const title = decodeHeaderTitle(headers['profile-title']);
  const lines = extractCandidateLines(body);

  const profiles = [];
  let skipped = 0;
  for (const line of lines) {
    try {
      profiles.push(detectAndParse(line));
    } catch (err) {
      skipped += 1;
    }
  }

  return { title, profiles, skipped, totalLines: lines.length };
}

module.exports = { fetchSubscription };
