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

function getXrayExe() {
  return path.join(getXrayDir(), 'xray.exe');
}

function getTun2socksExe() {
  return path.join(getTun2socksDir(), 'tun2socks.exe');
}

function getWintunDll() {
  return path.join(getTun2socksDir(), 'wintun.dll');
}

/**
 * AmneziaWG вшит прямо в приложение (см. `build.extraResources` в
 * package.json) — отдельно устанавливать и скачивать его больше не нужно.
 * В собранном виде файлы лежат в `<installDir>/resources/amneziawg/`
 * (electron-builder копирует их туда из `resources/amneziawg/` проекта);
 * в dev-режиме (`npm start`, unpacked) — там же в исходниках проекта.
 */
function getBundledAmneziaDir() {
  // app.isPackaged читается статически из самого объекта app, доступен даже
  // до app.whenReady()/initPaths() — не полагаемся здесь на appRef.
  const { app } = require('electron');
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'amneziawg');
  }
  return path.join(__dirname, '..', '..', 'resources', 'amneziawg');
}

function getBundledAmneziaExe() {
  return path.join(getBundledAmneziaDir(), 'amneziawg.exe');
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
