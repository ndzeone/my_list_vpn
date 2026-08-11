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

// ---- Автогенерация красивого описания релиза из git-коммитов ------------
// История проекта не в формате Conventional Commits — коммиты выглядят как
// "vX.Y.Z: <что изменилось>" или "<Глагол>: <что>" (см. `git log`), поэтому
// вместо строгого парсинга префиксов используем ключевые слова по всему
// тексту сообщения, а буллитом берём часть после первого ":" (если она есть
// и это не похоже на "Merge branch ...:" без содержательного текста).

function findPreviousTag(currentTag) {
  try {
    const tags = sh('git', ['tag', '--sort=-creatordate']).split('\n').map((s) => s.trim()).filter(Boolean);
    return tags.find((t) => t !== currentTag) || null;
  } catch (err) {
    return null;
  }
}

function collectCommitSubjects(prevTag) {
  const range = prevTag ? `${prevTag}..HEAD` : null;
  const args = ['log', '--pretty=format:%s'];
  if (range) args.push(range);
  else args.push('-n', '30'); // первый релиз без прошлого тега — не тащим всю историю
  let out;
  try {
    out = sh('git', args);
  } catch (err) {
    return [];
  }
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function classify(subject) {
  const s = subject.toLowerCase();
  if (/\bfix\b|фикс|исправ|бага?|bug|ошибк|hang|завис/.test(s)) return 'fix';
  if (/\bfeat\b|добав|новая?|новое|новый|new\b|\badd(ed)?\b|поддержк/.test(s)) return 'feat';
  return 'other';
}

function bulletText(subject) {
  const idx = subject.indexOf(':');
  // Берём текст после ":" только если префикс короткий и похож на тег/глагол
  // ("v1.1.1", "Add", "Merge"), а не на случайное двоеточие в описании.
  if (idx > 0 && idx < 24) {
    const rest = subject.slice(idx + 1).trim();
    if (rest) return rest;
  }
  return subject;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function buildReleaseNotes(version, tag, repo) {
  const prevTag = findPreviousTag(tag);
  const subjects = collectCommitSubjects(prevTag);

  const groups = { feat: [], fix: [], other: [] };
  for (const subject of subjects) {
    // Пропускаем служебные merge-коммиты без содержательного текста.
    if (/^merge (pull request|branch) /i.test(subject)) continue;
    groups[classify(subject)].push(capitalize(bulletText(subject)));
  }

  const lines = [`## My List VPN v${version}`, ''];
  if (groups.feat.length) {
    lines.push('### ✨ Новое', ...groups.feat.map((b) => `- ${b}`), '');
  }
  if (groups.fix.length) {
    lines.push('### 🐛 Исправления', ...groups.fix.map((b) => `- ${b}`), '');
  }
  if (groups.other.length) {
    lines.push('### 🔧 Прочее', ...groups.other.map((b) => `- ${b}`), '');
  }
  if (!groups.feat.length && !groups.fix.length && !groups.other.length) {
    lines.push(`Публикация версии ${version}.`, '');
  }
  if (prevTag) {
    lines.push(`**Полный список изменений:** https://github.com/${repo}/compare/${prevTag}...${tag}`);
  }
  return lines.join('\n').trim();
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
  const releaseNotes = buildReleaseNotes(version, tag, REPO);
  console.log('--- Сгенерированное описание релиза ---\n' + releaseNotes + '\n----------------------------------------');

  let release;
  try {
    release = await apiRequest('GET', `https://api.github.com/repos/${REPO}/releases/tags/${tag}`, token);
    console.log(`Релиз ${tag} уже существует (id ${release.id}), обновляю описание и дозаливаю ассет.`);
    release = await apiRequest('PATCH', `https://api.github.com/repos/${REPO}/releases/${release.id}`, token, {
      name: `My List VPN ${version}`,
      body: releaseNotes,
    });
  } catch (err) {
    release = await apiRequest('POST', `https://api.github.com/repos/${REPO}/releases`, token, {
      tag_name: tag,
      name: `My List VPN ${version}`,
      body: releaseNotes,
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
