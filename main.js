'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require('electron');
const path = require('path');

const paths = require('./src/core/paths');
const elevation = require('./src/core/elevation');
const coreManager = require('./src/core/coreManager');
const profileStore = require('./src/store/profileStore');
const accountStore = require('./src/store/accountStore');
const settingsStore = require('./src/store/settingsStore');
const parsers = require('./src/parsers');
const subscription = require('./src/core/subscription');
const updateChecker = require('./src/core/updateChecker');
const tunController = require('./src/engine/tunController');
const pingHelper = require('./src/engine/pingHelper');

// На части Windows-машин (обычно из-за антивируса или другого VPN/прокси-
// клиента, перехватывающего сетевой стек через Winsock LSP) песочница
// сетевого сервиса Chromium падает в цикл: "Network service crashed,
// restarting service" — и окно вовсе не появляется. Это официально
// задокументированный обходной путь для Electron на Windows.
app.commandLine.appendSwitch('disable-features', 'NetworkServiceSandbox');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow = null;
let tray = null;
let isQuitting = false;
let elevated = false;
// Ключ шифрования профилей, производный от пароля локального аккаунта.
// Живёт только в памяти процесса, появляется после createAccount()/login()
// и исчезает при logout() или выходе из приложения — на диске в открытом
// виде нигде не сохраняется.
let sessionKey = null;

function requireUnlocked() {
  if (!sessionKey) throw new Error('Сначала войдите в локальный аккаунт.');
  return sessionKey;
}

function iconPath() {
  const p = path.join(__dirname, 'assets', 'icon.png');
  return p;
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 640,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#0a0a0b',
    autoHideMenuBar: true,
    icon: iconPath(),
    title: 'My List VPN',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const image = nativeImage.createFromPath(iconPath());
  tray = new Tray(image.isEmpty() ? image : image.resize({ width: 16, height: 16 }));
  tray.setToolTip('My List VPN');
  rebuildTrayMenu();
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}

function rebuildTrayMenu() {
  if (!tray) return;
  const status = tunController.getStatus();
  const contextMenu = Menu.buildFromTemplate([
    { label: 'My List VPN', enabled: false },
    { type: 'separator' },
    { label: status.state === 'connected' ? 'Статус: подключено' : 'Статус: отключено', enabled: false },
    {
      label: status.state === 'connected' ? 'Отключить' : 'Открыть окно для подключения',
      click: async () => {
        if (status.state === 'connected') {
          await tunController.disconnect({
            onLog: (l) => send('vpn:log', l),
            onState: (s) => {
              send('vpn:state', s);
              rebuildTrayMenu();
            },
          });
        } else if (mainWindow) {
          mainWindow.show();
        }
      },
    },
    { label: 'Показать окно', click: () => mainWindow && mainWindow.show() },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

app.whenReady().then(async () => {
  paths.initPaths(app);
  elevated = await elevation.isElevated();

  createWindow();
  createTray();

  if (!elevated) {
    // Права администратора запрашиваются "по-настоящему" — через встроенный
    // в собранный .exe манифест requestedExecutionLevel=requireAdministrator
    // (build.win в package.json): Windows сама показывает UAC ДО того, как
    // процесс вообще стартует, никакого кода для этого не нужно. Если этот
    // блок вообще выполняется — значит, либо это неупакованный dev-режим
    // (`npm start`, манифест не применяется), либо пользователь ранее
    // отклонил UAC при установке. Автоматически перезапускать процесс через
    // PowerShell/`Start-Process -Verb RunAs` мы больше не пытаемся — это не
    // штатный способ и даёт пользователю лишний неожиданный UAC-попап поверх
    // уже открытого окна. Вместо этого просто показываем баннер с кнопкой:
    // повышение выполняется только по явному клику пользователя.
    console.warn('[main] запущено без прав администратора — TUN-режим будет недоступен, пока пользователь не подтвердит повышение вручную.');
    send('vpn:log', 'Приложение запущено без прав администратора. Для TUN-режима нажмите «Перезапустить от администратора» в баннере наверху, либо (в dev-режиме) запустите терминал от имени администратора и выполните npm start.');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  // Приложение живёт в трее — ничего не делаем, выход только через меню трея.
});

app.on('before-quit', async (e) => {
  if (tunController.getStatus().state === 'connected' && !app.__vpnStoppedOnQuit) {
    e.preventDefault();
    app.__vpnStoppedOnQuit = true;
    try {
      await tunController.disconnect({ onLog: () => {}, onState: () => {} });
    } catch (err) {
      console.error('Ошибка при отключении VPN во время выхода:', err);
    }
    isQuitting = true;
    app.quit();
  }
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// ---------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------

ipcMain.handle('app:info', () => ({ name: 'My List VPN', version: app.getVersion() }));

ipcMain.handle('update:check', () => updateChecker.checkForUpdate(app.getVersion()));

ipcMain.handle('elevation:status', () => elevated);

ipcMain.handle('elevation:relaunch', async () => {
  const result = await elevation.relaunchElevated(app);
  if (result.ok) {
    isQuitting = true;
    app.quit();
  } else {
    throw new Error(result.error);
  }
  return result;
});

// ---- Локальный аккаунт (шлюз к зашифрованным профилям) ----------------

ipcMain.handle('account:status', () => ({
  hasAccount: accountStore.hasAccount(),
  unlocked: !!sessionKey,
  info: accountStore.getPublicInfo(),
}));

ipcMain.handle('account:register', (evt, { email, password }) => {
  const account = accountStore.createAccount(email, password);
  sessionKey = account.key;
  return { email: account.email, id: account.id, createdAt: account.createdAt };
});

ipcMain.handle('account:login', (evt, { password }) => {
  const account = accountStore.login(password);
  sessionKey = account.key;
  return { email: account.email, id: account.id, createdAt: account.createdAt };
});

ipcMain.handle('account:logout', () => {
  sessionKey = null;
  return true;
});

ipcMain.handle('account:reset', async () => {
  // Единственный путь при забытом пароле — полностью локальный сброс.
  if (tunController.getStatus().state !== 'disconnected') {
    await tunController.disconnect({ onLog: () => {}, onState: () => {} });
  }
  sessionKey = null;
  accountStore.resetAccount();
  return true;
});

// ---- Профили (требуют разблокированного аккаунта) ---------------------

ipcMain.handle('profiles:list', () => profileStore.loadAll(requireUnlocked()));

ipcMain.handle('profiles:add', async (evt, { text, name }) => {
  const key = requireUnlocked();
  const trimmed = (text || '').trim();

  // Ссылка-подписка (http/https), а не отдельный конфиг: скачиваем и
  // раскладываем на все распознанные vless/trojan/WireGuard-строки внутри.
  if (/^https?:\/\//i.test(trimmed)) {
    const result = await subscription.fetchSubscription(trimmed);
    if (!result.profiles.length) {
      throw new Error(
        result.totalLines
          ? 'По этой ссылке нашлись строки, но ни одна не распознана (поддерживаются vless://, trojan://, WireGuard/AmneziaWG).'
          : 'По этой ссылке не удалось получить ни одного конфига — проверьте, что она открывается и действительна.'
      );
    }
    const added = result.profiles.map((p) => profileStore.add(p, key));
    const parts = [`Подписка${result.title ? ` «${result.title}»` : ''}: добавлено серверов — ${added.length}`];
    if (result.skipped) parts.push(`пропущено нераспознанных строк — ${result.skipped}`);
    send('vpn:log', parts.join(', ') + '.');
    return { multiple: true, profiles: added };
  }

  const parsed = parsers.detectAndParse(text, name);
  return profileStore.add(parsed, key);
});

ipcMain.handle('profiles:remove', async (evt, id) => {
  const key = requireUnlocked();
  if (tunController.getStatus().profileId === id) {
    await tunController.disconnect({ onLog: (l) => send('vpn:log', l), onState: (s) => send('vpn:state', s) });
  }
  profileStore.remove(id, key);
  return true;
});

ipcMain.handle('profiles:rename', (evt, { id, name }) => profileStore.update(id, { name }, requireUnlocked()));

ipcMain.handle('profiles:ping', async (evt, id) => {
  const profile = profileStore.getById(id, requireUnlocked());
  if (!profile) return null;
  try {
    return await pingHelper.pingProfile(profile);
  } catch (err) {
    return null;
  }
});

// ---- Сетевые настройки TUN (DNS/IP/порт для vless-trojan) -------------

ipcMain.handle('settings:networkGet', () => settingsStore.load());
ipcMain.handle('settings:networkSave', (evt, patch) => settingsStore.save(patch));
ipcMain.handle('settings:networkReset', () => settingsStore.reset());

ipcMain.handle('core:status', () => coreManager.status());

ipcMain.handle('core:installXrayStack', async () => {
  if (!elevated) throw new Error('Нужны права администратора. Перезапустите приложение от имени администратора.');
  await coreManager.installXrayStack((progress) => send('core:progress', progress));
  return coreManager.status();
});

ipcMain.handle('vpn:connect', async (evt, id) => {
  if (!elevated) throw new Error('Нужны права администратора для TUN-режима. Перезапустите приложение от имени администратора.');
  const key = requireUnlocked();
  await tunController.connect(id, key, {
    onLog: (l) => send('vpn:log', l),
    onState: (s) => {
      send('vpn:state', s);
      rebuildTrayMenu();
    },
  });
  return tunController.getStatus();
});

ipcMain.handle('vpn:disconnect', async () => {
  await tunController.disconnect({
    onLog: (l) => send('vpn:log', l),
    onState: (s) => {
      send('vpn:state', s);
      rebuildTrayMenu();
    },
  });
  return tunController.getStatus();
});

ipcMain.handle('vpn:status', () => tunController.getStatus());

ipcMain.handle('shell:openExternal', (evt, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});
