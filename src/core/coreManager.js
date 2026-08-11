'use strict';
/**
 * Загрузка и установка «движков» туннеля:
 *  - Xray-core + tun2socks + wintun.dll  → портативные бинарники, используются
 *    для vless:// и trojan:// профилей (Xray поднимает локальный SOCKS,
 *    tun2socks поверх wintun превращает его в системный TUN-адаптер). Качаются
 *    с GitHub Releases при первом запуске — версии в коде не зашиты, только
 *    имена ассетов.
 *  - AmneziaWG для Windows  → вшит прямо в приложение (см.
 *    `resources/amneziawg/` и `build.extraResources` в package.json), ничего
 *    отдельно скачивать и ставить не нужно — используется и для AmneziaWG, и
 *    для обычных WireGuard-конфигов (движок обратно совместим). Обновляется
 *    сборочным скриптом `npm run fetch-amneziawg`, а не в рантайме.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');

const paths = require('./paths');

const IS_WIN = process.platform === 'win32';
const UA = { 'User-Agent': 'My-List-VPN (github release fetcher)' };
const WINTUN_URL = 'https://www.wintun.net/builds/wintun-0.14.1.zip';

// Имена ассетов в GitHub Releases отличаются по платформе — сборки уже
// готовые для обеих ОС существуют в апстриме (Xray-core, xjasonlyu/tun2socks),
// здесь только выбираем нужный файл. Намеренно не выносится в src/platform/
// (см. план) — coreManager.js не должен зависеть от src/platform, чтобы не
// возникло цикла require с platform/win/wgBackend.js (которому, наоборот,
// нужен coreManager.findAmneziaExe()).
const XRAY_ASSET_NAME = IS_WIN ? 'Xray-windows-64.zip' : 'Xray-linux-64.zip';
const TUN2SOCKS_ASSET_NAME = IS_WIN ? 'tun2socks-windows-amd64.zip' : 'tun2socks-linux-amd64.zip';

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

function downloadFile(url, destPath, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('Слишком много перенаправлений при скачивании ' + url));
      return;
    }
    https
      .get(url, { headers: UA }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          downloadFile(res.headers.location, destPath, onProgress, redirects + 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Ошибка загрузки (${res.statusCode}): ${url}`));
          return;
        }
        const total = Number(res.headers['content-length'] || 0);
        let received = 0;
        const file = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress) onProgress(received, total);
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(destPath)));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

async function getLatestAsset(repo, matcher) {
  const release = await httpGetJson(`https://api.github.com/repos/${repo}/releases/latest`);
  const assets = release.assets || [];
  const found = assets.find((a) => matcher(a.name));
  if (!found) {
    throw new Error(`Не найден подходящий файл в релизе ${repo} (${release.tag_name || '?'})`);
  }
  return { url: found.browser_download_url, name: found.name, tag: release.tag_name };
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

function extractZip(zipPath, destDir) {
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destDir, true);
}

// ---- Статус движков -------------------------------------------------

function amneziaCandidatePaths() {
  // Встроенный вариант — основной, всегда должен существовать в собранном
  // приложении. Пути Program Files оставлены только как запасной вариант
  // для машин, где раньше стояла отдельно установленная старая версия
  // AmneziaWG (до того, как её встроили в это приложение).
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return [
    paths.getBundledAmneziaExe(),
    path.join(pf, 'AmneziaWG', 'amneziawg.exe'),
    path.join(pf86, 'AmneziaWG', 'amneziawg.exe'),
    path.join(pf, 'AmneziaWG', 'wireguard.exe'),
    path.join(pf86, 'AmneziaWG', 'wireguard.exe'),
  ];
}

function findAmneziaExe() {
  if (!IS_WIN) return null; // на Linux нет единого бинарника, см. findLinuxWgTools()
  return amneziaCandidatePaths().find((p) => fs.existsSync(p)) || null;
}

function commandExistsOnPath(cmd) {
  try {
    // `which` есть на любом Linux из coreutils — то же самое, чем позже
    // реально воспользуется elevation.runPrivileged() при подключении.
    execFileSync('which', [cmd], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * На Linux нет вшитого бинарника — используются штатные wg-quick (обычный
 * WireGuard, wireguard-tools из репозиториев Fedora) и awg-quick (AmneziaWG,
 * из COPR, см. README). Оба опциональны по отдельности: без awg-quick можно
 * подключать обычные .conf, без него — только они.
 */
function findLinuxWgTools() {
  return { wgQuick: commandExistsOnPath('wg-quick'), awgQuick: commandExistsOnPath('awg-quick') };
}

function status() {
  if (!IS_WIN) {
    const wg = findLinuxWgTools();
    return {
      xray: fs.existsSync(paths.getXrayExe()),
      tun2socks: fs.existsSync(paths.getTun2socksExe()), // wintun.dll на Linux не нужен
      amnezia: wg.wgQuick || wg.awgQuick,
      amneziaPath: null,
      wgQuickAvailable: wg.wgQuick,
      awgQuickAvailable: wg.awgQuick,
    };
  }
  return {
    xray: fs.existsSync(paths.getXrayExe()),
    tun2socks: fs.existsSync(paths.getTun2socksExe()) && fs.existsSync(paths.getWintunDll()),
    amnezia: !!findAmneziaExe(),
    amneziaPath: findAmneziaExe(),
  };
}

// ---- Установка: Xray-core -------------------------------------------

async function installXray(onProgress) {
  onProgress && onProgress({ stage: 'xray', phase: 'lookup' });
  const asset = await getLatestAsset('XTLS/Xray-core', (n) => n === XRAY_ASSET_NAME);
  const zipPath = path.join(paths.getDownloadsDir(), asset.name);
  onProgress && onProgress({ stage: 'xray', phase: 'download', name: asset.name });
  await downloadFile(asset.url, zipPath, (received, total) =>
    onProgress && onProgress({ stage: 'xray', phase: 'download', received, total })
  );
  onProgress && onProgress({ stage: 'xray', phase: 'extract' });
  extractZip(zipPath, paths.getXrayDir());
  if (!fs.existsSync(paths.getXrayExe())) {
    const exeName = IS_WIN ? 'xray.exe' : 'xray';
    const found = findFileRecursive(paths.getXrayDir(), (n) => n.toLowerCase() === exeName);
    if (!found) throw new Error(`${exeName} не найден внутри архива после распаковки.`);
    fs.copyFileSync(found, paths.getXrayExe());
    if (!IS_WIN) fs.chmodSync(paths.getXrayExe(), 0o755);
  }
  onProgress && onProgress({ stage: 'xray', phase: 'done' });
}

// ---- Установка: tun2socks (+ wintun.dll на Windows) -------------------

async function installTun2socks(onProgress) {
  onProgress && onProgress({ stage: 'tun2socks', phase: 'lookup' });
  const asset = await getLatestAsset('xjasonlyu/tun2socks', (n) => n === TUN2SOCKS_ASSET_NAME);
  const zipPath = path.join(paths.getDownloadsDir(), asset.name);
  onProgress && onProgress({ stage: 'tun2socks', phase: 'download', name: asset.name });
  await downloadFile(asset.url, zipPath, (received, total) =>
    onProgress && onProgress({ stage: 'tun2socks', phase: 'download', received, total })
  );
  onProgress && onProgress({ stage: 'tun2socks', phase: 'extract' });
  extractZip(zipPath, paths.getTun2socksDir());
  const exeMatcher = IS_WIN ? (n) => /^tun2socks.*\.exe$/i.test(n) : (n) => /^tun2socks/i.test(n) && !/\.exe$/i.test(n);
  const foundExe = findFileRecursive(paths.getTun2socksDir(), exeMatcher);
  if (!foundExe) throw new Error('tun2socks не найден внутри архива после распаковки.');
  if (foundExe !== paths.getTun2socksExe()) fs.copyFileSync(foundExe, paths.getTun2socksExe());
  if (!IS_WIN) fs.chmodSync(paths.getTun2socksExe(), 0o755);

  if (!IS_WIN) {
    // На Linux TUN даёт ядро (/dev/net/tun) — отдельного драйвера-адаптера,
    // как wintun.dll на Windows, не требуется.
    onProgress && onProgress({ stage: 'tun2socks', phase: 'done' });
    return;
  }

  // wintun.dll (только Windows)
  onProgress && onProgress({ stage: 'wintun', phase: 'download' });
  const wintunZip = path.join(paths.getDownloadsDir(), 'wintun.zip');
  await downloadFile(WINTUN_URL, wintunZip, (received, total) =>
    onProgress && onProgress({ stage: 'wintun', phase: 'download', received, total })
  );
  const wintunExtractDir = path.join(paths.getDownloadsDir(), 'wintun-extract');
  onProgress && onProgress({ stage: 'wintun', phase: 'extract' });
  extractZip(wintunZip, wintunExtractDir);
  const dll = findFileRecursive(wintunExtractDir, (n) => n.toLowerCase() === 'wintun.dll') &&
    // предпочитаем amd64-сборку, если структура папок это позволяет определить
    (findFileRecursive(path.join(wintunExtractDir, 'wintun', 'bin', 'amd64'), (n) => n.toLowerCase() === 'wintun.dll') ||
      findFileRecursive(wintunExtractDir, (n) => n.toLowerCase() === 'wintun.dll'));
  if (!dll) throw new Error('wintun.dll не найден внутри архива wintun после распаковки.');
  fs.copyFileSync(dll, paths.getWintunDll());
  onProgress && onProgress({ stage: 'tun2socks', phase: 'done' });
}

async function installXrayStack(onProgress) {
  await installXray(onProgress);
  await installTun2socks(onProgress);
}

module.exports = {
  status,
  findAmneziaExe,
  installXrayStack,
};
