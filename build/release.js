'use strict';
/**
 * Публикует релиз на GitHub: создаёт git-тег vX.Y.Z из версии в package.json,
 * пушит его, создаёт GitHub Release и заливает установщик из dist/*.exe как
 * ассет. Заменяет собой ручную работу с `gh release create` — gh CLI на этой
 * машине не установлен, поэтому всё сделано через REST API напрямую.
 *
 * Токен берётся из `.release-token` в корне проекта (в .gitignore, никогда
 * не коммитится) — fine-grained Personal Access Token с правом
 * "Contents: Read and write" на этот репозиторий.
 *
 * Порядок действий перед запуском:
 *   1. Поднять "version" в package.json
 *   2. npm run dist   (собрать dist/My List VPN Setup X.Y.Z.exe)
 *   3. Закоммитить и запушить изменения кода в main
 *   4. npm run release
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPO = require('../src/core/updateChecker').REPO; // 'ndzeone/my_list_vpn'
const TOKEN_FILE = path.join(ROOT, '.release-token');

function readToken() {
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error(`Не найден ${TOKEN_FILE}. Положите туда GitHub-токен (Contents: Read and write) одной строкой.`);
  }
  return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
}

function apiRequest(method, urlStr, token, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const payload = body && !Buffer.isBuffer(body) ? JSON.stringify(body) : body;
    const headers = Object.assign(
      {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'My-List-VPN (release script)',
      },
      body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      extraHeaders || {}
    );
    const req = https.request(
      { hostname: url.hostname, path: url.pathname + url.search, method, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch (err) {
            /* не JSON (например, пустой ответ на DELETE) — оставляем null */
          }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(`${method} ${url.pathname} -> ${res.statusCode}: ${data.slice(0, 500)}`));
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sh(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

async function main() {
  const token = readToken();
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;
  const tag = `v${version}`;

  // dist/ может содержать установщики от прошлых версий (старые сборки не
  // удаляются автоматически) — берём строго тот, что соответствует текущей
  // версии из package.json, а не первый попавшийся .exe.
  const installer = fs
    .readdirSync(path.join(ROOT, 'dist'))
    .find((n) => n.toLowerCase().endsWith('.exe') && n.includes(version) && !n.toLowerCase().includes('elevate'));
  if (!installer) {
    throw new Error(`В dist/ нет установщика для версии ${version} — сначала выполните npm run dist.`);
  }
  const installerPath = path.join(ROOT, 'dist', installer);

  console.log(`Версия: ${version}, тег: ${tag}, файл: ${installer} (${(fs.statSync(installerPath).size / 1e6).toFixed(1)} МБ)`);

  // 1. Тег + пуш (используем текущий HEAD; если тег уже есть локально — не пересоздаём).
  const existingTags = sh('git', ['tag', '--list', tag]);
  if (!existingTags) {
    sh('git', ['tag', tag]);
    console.log(`Создан тег ${tag}.`);
  } else {
    console.log(`Тег ${tag} уже существует локально.`);
  }
  const authHeader = 'basic ' + Buffer.from(`ndzeone:${token}`).toString('base64');
  sh('git', ['-c', `http.extraheader=AUTHORIZATION: ${authHeader}`, 'push', 'origin', tag]);
  console.log(`Тег ${tag} запушен.`);

  // 2. GitHub Release (создаём или переиспользуем, если уже есть с этим тегом).
  let release;
  try {
    release = await apiRequest('GET', `https://api.github.com/repos/${REPO}/releases/tags/${tag}`, token);
    console.log(`Релиз ${tag} уже существует (id ${release.id}), дозаливаю ассет.`);
  } catch (err) {
    release = await apiRequest('POST', `https://api.github.com/repos/${REPO}/releases`, token, {
      tag_name: tag,
      name: `My List VPN ${version}`,
      body: `Автоматическая публикация версии ${version}.`,
      draft: false,
      prerelease: false,
    });
    console.log(`Релиз ${tag} создан (id ${release.id}).`);
  }

  // 3. Если ассет с таким именем уже прикреплён — удаляем перед перезаливкой.
  const existingAsset = (release.assets || []).find((a) => a.name === installer);
  if (existingAsset) {
    await apiRequest('DELETE', `https://api.github.com/repos/${REPO}/releases/assets/${existingAsset.id}`, token);
    console.log('Старый ассет с таким именем удалён, заливаю заново.');
  }

  const fileBuf = fs.readFileSync(installerPath);
  const uploadUrl = `https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(installer)}`;
  await apiRequest('POST', uploadUrl, token, fileBuf, { 'Content-Type': 'application/octet-stream' });
  console.log(`Установщик загружен в релиз: https://github.com/${REPO}/releases/tag/${tag}`);
}

main().catch((err) => {
  console.error('Ошибка публикации релиза:', err.message);
  process.exit(1);
});
