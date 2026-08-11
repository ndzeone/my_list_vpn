'use strict';
/**
 * Централизованные пути приложения (userData, папки движков, рабочие файлы).
 * Всё, что скачивается или генерируется во время работы, живёт вне исходников
 * приложения — в app.getPath('userData'), чтобы работать и из портативной,
 * и из установленной версии.
 */
const path = require('path');
const fs = require('fs');

let appRef = null;

function initPaths(electronApp) {
  appRef = electronApp;
  ensureDir(getUserDataDir());
  ensureDir(getCoreDir());
  ensureDir(getXrayDir());
  ensureDir(getTun2socksDir());
  ensureDir(getRunDir());
  ensureDir(getDownloadsDir());
  ensureDir(getLogsDir());
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
}

function getUserDataDir() {
  return appRef.getPath('userData');
}

function getCoreDir() {
  return path.join(getUserDataDir(), 'core');
}

function getXrayDir() {
  return path.join(getCoreDir(), 'xray');
}

function getTun2socksDir() {
  return path.join(getCoreDir(), 'tun2socks');
}

function getRunDir() {
  return path.join(getUserDataDir(), 'run');
}

function getDownloadsDir() {
  return path.join(getUserDataDir(), 'downloads');
}

function getLogsDir() {
  return path.join(getUserDataDir(), 'logs');
}

function getProfilesFile() {
  return path.join(getUserDataDir(), 'profiles.json');
}

function getAccountFile() {
  return path.join(getUserDataDir(), 'account.json');
}

const IS_WIN = process.platform === 'win32';

function getXrayExe() {
  return path.join(getXrayDir(), IS_WIN ? 'xray.exe' : 'xray');
}

function getTun2socksExe() {
  return path.join(getTun2socksDir(), IS_WIN ? 'tun2socks.exe' : 'tun2socks');
}

function getWintunDll() {
  // wintun.dll нужен только на Windows (tun2socks грузит его как драйвер
  // адаптера) — на Linux TUN даёт само ядро через /dev/net/tun, скачивать
  // и проверять здесь нечего.
  return path.join(getTun2socksDir(), 'wintun.dll');
}

/**
 * AmneziaWG вшит прямо в приложение только на Windows (см.
 * `build.extraResources` в package.json) — отдельно устанавливать и
 * скачивать его там не нужно. В собранном виде файлы лежат в
 * `<installDir>/resources/amneziawg/` (electron-builder копирует их туда из
 * `resources/amneziawg/` проекта); в dev-режиме (`npm start`, unpacked) —
 * там же в исходниках проекта.
 *
 * На Linux ничего не бандлится — используются штатные `wg-quick`/
 * `awg-quick` из системы (см. src/platform/linux/wgBackend.js), поэтому обе
 * функции ниже возвращают null.
 */
function getBundledAmneziaDir() {
  if (!IS_WIN) return null;
  // app.isPackaged читается статически из самого объекта app, доступен даже
  // до app.whenReady()/initPaths() — не полагаемся здесь на appRef.
  const { app } = require('electron');
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'amneziawg');
  }
  return path.join(__dirname, '..', '..', 'resources', 'amneziawg');
}

function getBundledAmneziaExe() {
  const dir = getBundledAmneziaDir();
  return dir ? path.join(dir, 'amneziawg.exe') : null;
}

module.exports = {
  initPaths,
  ensureDir,
  getUserDataDir,
  getCoreDir,
  getXrayDir,
  getTun2socksDir,
  getRunDir,
  getDownloadsDir,
  getLogsDir,
  getProfilesFile,
  getAccountFile,
  getXrayExe,
  getTun2socksExe,
  getWintunDll,
  getBundledAmneziaDir,
  getBundledAmneziaExe,
};
