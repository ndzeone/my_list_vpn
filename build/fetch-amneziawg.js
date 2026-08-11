'use strict';
/**
 * Обновляет встроенный движок AmneziaWG в `resources/amneziawg/` (bundled
 * через `extraResources` в package.json — см. секцию build). Раньше
 * приложение само качало и ставило официальный MSI при первом запуске
 * (coreManager.installAmneziaWG); теперь бинарник живёт прямо внутри
 * инсталлятора программы, отдельного "AmneziaWG" в списке программ
 * Windows больше не появляется.
 *
 * MSI не запускается как инсталлятор (это потребовало бы прав
 * администратора и оставляло бы отдельную запись в Program Files) — вместо
 * этого используется штатная "административная" распаковка MSI
 * (`msiexec /a ... TARGETDIR=...`), которая просто раскладывает файлы на
 * диск без записи в реестр и без прав администратора.
 *
 * Запуск вручную: node build/fetch-amneziawg.js
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const UA = { 'User-Agent': 'My-List-VPN (build script)' };
const RESOURCES_DIR = path.join(__dirname, '..', 'resources', 'amneziawg');

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: Object.assign({ Accept: 'application/vnd.github+json' }, UA) }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          httpGetJson(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API вернул ${res.statusCode} для ${url}`));
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
      })
      .on('error', reject);
  });
}

function downloadFile(url, destPath, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('Слишком много перенаправлений при скачивании ' + url));
      return;
    }
    https
      .get(url, { headers: UA }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          downloadFile(res.headers.location, destPath, redirects + 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Ошибка загрузки (${res.statusCode}): ${url}`));
          return;
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(destPath)));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

async function main() {
  console.log('Ищу последний релиз amnezia-vpn/amneziawg-windows-client...');
  const release = await httpGetJson('https://api.github.com/repos/amnezia-vpn/amneziawg-windows-client/releases/latest');
  const asset = (release.assets || []).find((a) => /^amneziawg-amd64-[\d.]+\.msi$/i.test(a.name));
  if (!asset) throw new Error('Не найден amneziawg-amd64-*.msi в последнем релизе.');
  console.log(`Найден ${asset.name} (${release.tag_name})`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awg-fetch-'));
  const msiPath = path.join(tmpDir, asset.name);
  console.log('Скачиваю MSI...');
  await downloadFile(asset.browser_download_url, msiPath);

  const extractDir = path.join(tmpDir, 'extracted');
  fs.mkdirSync(extractDir, { recursive: true });
  console.log('Распаковываю MSI (административная распаковка, без установки)...');
  const result = spawnSync(
    'msiexec.exe',
    ['/a', msiPath, '/qn', `TARGETDIR=${extractDir}`, '/log', path.join(tmpDir, 'msiextract.log')],
    { stdio: 'inherit' }
  );
  if (result.status !== 0) {
    throw new Error(`msiexec /a завершился с кодом ${result.status}. Смотрите ${path.join(tmpDir, 'msiextract.log')}`);
  }

  const exeSrc = findFileRecursive(extractDir, (n) => n.toLowerCase() === 'amneziawg.exe');
  const dllSrc = findFileRecursive(extractDir, (n) => n.toLowerCase() === 'wintun.dll');
  if (!exeSrc) throw new Error('amneziawg.exe не найден внутри распакованного MSI.');

  fs.mkdirSync(RESOURCES_DIR, { recursive: true });
  fs.copyFileSync(exeSrc, path.join(RESOURCES_DIR, 'amneziawg.exe'));
  if (dllSrc) fs.copyFileSync(dllSrc, path.join(RESOURCES_DIR, 'wintun.dll'));
  fs.writeFileSync(path.join(RESOURCES_DIR, 'VERSION'), `${release.tag_name}\n`, 'utf8');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`Готово: resources/amneziawg/amneziawg.exe обновлён до ${release.tag_name}.`);
}

function findFileRecursive(dir, predicate) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, predicate);
      if (found) return found;
    } else if (predicate(entry.name)) {
      return full;
    }
  }
  return null;
}

main().catch((err) => {
  console.error('Не удалось обновить AmneziaWG:', err.message);
  process.exit(1);
});
