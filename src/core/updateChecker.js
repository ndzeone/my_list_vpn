'use strict';
/**
 * Проверка обновлений через GitHub Releases репозитория проекта. Ничего не
 * скачивает и не ставит сама — только сравнивает версию из package.json с
 * последним релизом на GitHub и возвращает ссылку, если есть новее. Само
 * скачивание пользователь делает вручную — кнопка в интерфейсе открывает
 * страницу релиза в браузере (см. renderer.js/updateBadge).
 */
const https = require('https');

const REPO = 'ndzeone/my_list_vpn';
const UA = { 'User-Agent': 'My-List-VPN (update checker)' };

function httpGetJson(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('Слишком много перенаправлений.'));
      return;
    }
    const req = https
      .get(
        url,
        { headers: Object.assign({ Accept: 'application/vnd.github+json' }, UA), timeout: 8000 },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            httpGetJson(res.headers.location, redirects + 1).then(resolve, reject);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`GitHub API вернул ${res.statusCode}`));
            res.resume();
            return;
          }
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (err) {
              reject(err);
            }
          });
        }
      )
      .on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Таймаут проверки обновлений.')));
  });
}

function parseVersion(v) {
  return String(v || '')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
}

function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function checkForUpdate(currentVersion) {
  try {
    const release = await httpGetJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (!release || !release.tag_name) return { hasUpdate: false };
    const latestVersion = String(release.tag_name).replace(/^v/i, '');
    return {
      hasUpdate: isNewer(latestVersion, currentVersion),
      latestVersion,
      url: release.html_url || `https://github.com/${REPO}/releases/latest`,
    };
  } catch (err) {
    // Нет сети, репозиторий ещё не заведён, лимит GitHub API и т.п. — тихо
    // считаем, что обновлений нет, чтобы не пугать пользователя ошибкой при
    // каждом старте из-за того, что вообще недоступно.
    return { hasUpdate: false, error: err.message };
  }
}

module.exports = { checkForUpdate, REPO };
