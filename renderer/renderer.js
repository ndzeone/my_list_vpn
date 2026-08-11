'use strict';

const UPDATE_INTERVAL_OPTIONS = [1, 3, 6, 12, 24];

const state = {
  profiles: [],
  selectedId: null,
  vpn: { state: 'disconnected', profileId: null, mode: null, connectedSince: null },
  mode: 'tun', // выбранный на главном экране режим TUN/PROXY (до подключения)
  logs: [],
  elevated: true,
  platform: null, // 'win32' | 'linux' — заполняется из app:info в afterUnlock()
  pings: {}, // id -> ms|null
  updateInfo: null,
  settings: null, // последняя загруженная копия network-settings.json (сеть + поведение)
  view: 'home',
  settingsTab: 'general',
};

const el = (id) => document.getElementById(id);

const els = {
  appRoot: el('appRoot'),

  authScreen: el('authScreen'),
  authRegisterForm: el('authRegisterForm'),
  authLoginForm: el('authLoginForm'),
  regEmail: el('regEmail'),
  regPassword: el('regPassword'),
  regPassword2: el('regPassword2'),
  registerBtn: el('registerBtn'),
  loginEmailLabel: el('loginEmailLabel'),
  loginPassword: el('loginPassword'),
  loginBtn: el('loginBtn'),
  resetAccountBtn: el('resetAccountBtn'),
  authError: el('authError'),

  accountEmail: el('accountEmail'),
  accountIdText: el('accountIdText'),
  logoutBtn: el('logoutBtn'),

  adminBanner: el('adminBanner'),
  relaunchAdminBtn: el('relaunchAdminBtn'),

  updateBadge: el('updateBadge'),
  updateBadgeText: el('updateBadgeText'),

  navHome: el('navHome'),
  navServers: el('navServers'),
  navSettings: el('navSettings'),
  railHomeDot: el('railHomeDot'),
  viewHome: el('viewHome'),
  viewServers: el('viewServers'),
  viewSettings: el('viewSettings'),

  modeSwitch: el('modeSwitch'),
  modeTunBtn: el('modeTunBtn'),
  modeProxyBtn: el('modeProxyBtn'),

  powerBtn: el('powerBtn'),
  ringPulse: el('ringPulse'),
  statusText: el('statusText'),
  statusSub: el('statusSub'),
  cancelConnectBtn: el('cancelConnectBtn'),

  serverCard: el('serverCard'),
  serverTypeBadge: el('serverTypeBadge'),
  serverCardName: el('serverCardName'),
  serverCardSub: el('serverCardSub'),
  serverCardPing: el('serverCardPing'),

  logOutput: el('logOutput'),
  clearLogBtn: el('clearLogBtn'),

  addProfileBtn: el('addProfileBtn'),
  profileList: el('profileList'),

  settingsTabs: el('settingsTabs'),

  defaultModeSeg: el('defaultModeSeg'),
  chkAutostart: el('chkAutostart'),
  chkAutoConnect: el('chkAutoConnect'),
  chkStartMinimized: el('chkStartMinimized'),
  closeBehaviorSeg: el('closeBehaviorSeg'),
  updateIntervalSelect: el('updateIntervalSelect'),

  netDns1: el('netDns1'),
  netDns2: el('netDns2'),
  netTunIp: el('netTunIp'),
  netSocksPort: el('netSocksPort'),
  netHttpPort: el('netHttpPort'),
  chkAutoSystemProxy: el('chkAutoSystemProxy'),
  autoSystemProxyRow: el('autoSystemProxyRow'),
  linuxProxyHint: el('linuxProxyHint'),
  netSettingsError: el('netSettingsError'),
  netSettingsSaveBtn: el('netSettingsSaveBtn'),
  netSettingsResetBtn: el('netSettingsResetBtn'),

  xrayStatusText: el('xrayStatusText'),
  installXrayBtn: el('installXrayBtn'),
  xrayProgress: el('xrayProgress'),
  amneziaStatusText: el('amneziaStatusText'),
  versionText: el('versionText'),
  aboutVersionText: el('aboutVersionText'),
  forceResetBtn: el('forceResetBtn'),
  openUserDataBtn: el('openUserDataBtn'),

  modalBackdrop: el('modalBackdrop'),
  modalName: el('modalName'),
  modalText: el('modalText'),
  modalError: el('modalError'),
  modalCancel: el('modalCancel'),
  modalSave: el('modalSave'),

  toastContainer: el('toastContainer'),
};

let uptimeTimer = null;

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function typeLabel(p) {
  if (p.type === 'vless') return 'VLESS';
  if (p.type === 'trojan') return 'Trojan';
  if (p.type === 'wireguard') return p.isAmnezia ? 'AmneziaWG' : 'WireGuard';
  return p.type;
}

function typeBadge(p) {
  if (p.type === 'vless') return 'VL';
  if (p.type === 'trojan') return 'TR';
  if (p.type === 'wireguard') return p.isAmnezia ? 'AW' : 'WG';
  return '?';
}

function currentProfile() {
  return state.profiles.find((p) => p.id === state.selectedId) || null;
}

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function fmtPing(ms) {
  if (ms == null) return { text: '—', cls: 'down' };
  if (ms < 150) return { text: `${ms} мс`, cls: '' };
  if (ms < 400) return { text: `${ms} мс`, cls: 'slow' };
  return { text: `${ms} мс`, cls: 'down' };
}

// ---- Toasts (заменяют alert() для некритичных ошибок) --------------------

function showToast(message, type = 'info', timeoutMs = 4500) {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  els.toastContainer.appendChild(t);
  setTimeout(() => t.remove(), timeoutMs);
}

// ---- Навигация: рейл + вкладки настроек -----------------------------------

function switchView(view) {
  state.view = view;
  els.viewHome.classList.toggle('hidden', view !== 'home');
  els.viewServers.classList.toggle('hidden', view !== 'servers');
  els.viewSettings.classList.toggle('hidden', view !== 'settings');
  els.navHome.classList.toggle('active', view === 'home');
  els.navServers.classList.toggle('active', view === 'servers');
  els.navSettings.classList.toggle('active', view === 'settings');
  if (view === 'settings') openSettingsView();
}

[els.navHome, els.navServers, els.navSettings].forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function switchSettingsTab(tab) {
  state.settingsTab = tab;
  document.querySelectorAll('#settingsTabs .tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.tabPanel !== tab));
}
els.settingsTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (btn) switchSettingsTab(btn.dataset.tab);
});

async function openSettingsView() {
  switchSettingsTab(state.settingsTab);
  await refreshCoreStatus();
  await loadAppSettings();
  await refreshAccountBadge();
  els.chkAutostart.checked = await window.api.autostartGet();
}

// ---- Режим TUN/PROXY (главный экран) ---------------------------------------

function updateModeAvailability() {
  const p = currentProfile();
  const proxyDisabled = !!p && p.type === 'wireguard';
  els.modeProxyBtn.disabled = proxyDisabled;
  els.modeProxyBtn.title = proxyDisabled ? 'WireGuard/AmneziaWG поддерживает только режим TUN' : '';
  if (proxyDisabled && state.mode === 'proxy') setMode('tun');
}

function setMode(mode) {
  state.mode = mode;
  els.modeTunBtn.classList.toggle('active', mode === 'tun');
  els.modeProxyBtn.classList.toggle('active', mode === 'proxy');
}
els.modeTunBtn.addEventListener('click', () => setMode('tun'));
els.modeProxyBtn.addEventListener('click', () => setMode('proxy'));

// ---- Рендер верхней карточки (главный экран) --------------------------

function renderServerCard() {
  const p = currentProfile();
  updateModeAvailability();
  if (!p) {
    els.serverTypeBadge.textContent = '+';
    els.serverCardName.textContent = 'Нет добавленных серверов';
    els.serverCardSub.textContent = 'Нажмите, чтобы добавить конфиг';
    els.serverCardPing.textContent = '';
    return;
  }
  els.serverTypeBadge.textContent = typeBadge(p);
  els.serverCardName.textContent = p.name;
  els.serverCardSub.textContent = typeLabel(p) + (p.summary?.address ? ` · ${p.summary.address}` : '');

  const pingVal = state.pings[p.id];
  if (pingVal === undefined) {
    els.serverCardPing.textContent = '';
  } else {
    const { text, cls } = fmtPing(pingVal);
    els.serverCardPing.textContent = text;
    els.serverCardPing.className = 'server-card-ping ' + cls;
  }
}

async function refreshPing(id) {
  if (!id) return;
  state.pings[id] = state.pings[id] ?? null;
  const ms = await window.api.profilesPing(id);
  state.pings[id] = ms;
  if (id === state.selectedId) renderServerCard();
}

// ---- Кнопка питания / статус ------------------------------------------

function renderPower() {
  const p = currentProfile();
  const isThisActive = p && state.vpn.profileId === p.id;
  const s = isThisActive ? state.vpn.state : 'disconnected';
  const activeMode = isThisActive ? state.vpn.mode : null;

  els.powerBtn.className = 'power-btn';
  els.ringPulse.classList.remove('active');
  els.powerBtn.disabled = false;
  els.cancelConnectBtn.classList.add('hidden');
  els.modeTunBtn.disabled = false;

  if (s === 'connected') {
    els.powerBtn.classList.add('connected');
    els.statusText.textContent = 'Подключено';
    els.statusSub.textContent = activeMode === 'proxy' ? 'Режим PROXY — локальный прокси активен' : '';
  } else if (s === 'connecting') {
    els.powerBtn.classList.add('connecting');
    els.ringPulse.classList.add('active');
    els.statusText.textContent = 'Подключение…';
    els.statusSub.textContent = state.mode === 'proxy' ? 'Поднимаю локальный прокси' : 'Настраиваю TUN-адаптер и маршруты';
    els.powerBtn.disabled = true;
    els.cancelConnectBtn.classList.remove('hidden');
  } else if (s === 'disconnecting') {
    els.ringPulse.classList.add('active');
    els.statusText.textContent = 'Отключение…';
    els.statusSub.textContent = '';
    els.powerBtn.disabled = true;
  } else {
    els.statusText.textContent = 'Отключено';
    els.statusSub.textContent = p
      ? (state.vpn.profileId && state.vpn.profileId !== p.id ? 'Активен другой сервер' : 'Нажмите на кнопку, чтобы подключиться')
      : 'Сначала добавьте сервер';
    if (state.vpn.profileId && p && state.vpn.profileId !== p.id) els.powerBtn.disabled = true;
    if (!p) els.powerBtn.disabled = true;
  }

  els.railHomeDot.classList.toggle('hidden', state.vpn.state !== 'connected');

  clearInterval(uptimeTimer);
  if (s === 'connected' && state.vpn.connectedSince) {
    const tick = () => (els.statusSub.textContent = fmtUptime(Date.now() - state.vpn.connectedSince));
    tick();
    uptimeTimer = setInterval(tick, 1000);
  }
}

// ---- Список серверов -------------------------------------------------

function renderProfileList() {
  if (!state.profiles.length) {
    els.profileList.innerHTML = '<div class="empty-state">Пока нет ни одного сервера — нажмите «Добавить конфиг».</div>';
    return;
  }
  els.profileList.innerHTML = '';
  for (const p of state.profiles) {
    const item = document.createElement('div');
    item.className = 'profile-item';
    if (p.id === state.selectedId) item.classList.add('active');
    if (state.vpn.state === 'connected' && state.vpn.profileId === p.id) item.classList.add('connected');
    item.innerHTML = `
      <span class="badge"></span>
      <span class="profile-item-text">${escapeHtml(p.name)}</span>
      <span class="profile-item-type">${typeLabel(p)}</span>
      <span class="profile-item-actions">
        <button data-act="rename" title="Переименовать">✎</button>
        <button data-act="delete" title="Удалить">🗑</button>
      </span>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.closest('[data-act]')) return;
      selectProfile(p.id);
      switchView('home');
    });
    item.querySelector('[data-act="rename"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = prompt('Новое имя профиля:', p.name);
      if (name && name.trim()) {
        await window.api.profilesRename(p.id, name.trim());
        await refreshProfiles();
      }
    });
    item.querySelector('[data-act="delete"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Удалить профиль «${p.name}»?`)) return;
      await window.api.profilesRemove(p.id);
      if (state.selectedId === p.id) state.selectedId = null;
      await refreshProfiles();
      if (!state.selectedId && state.profiles.length) selectProfile(state.profiles[0].id);
      else renderServerCard();
    });
    els.profileList.appendChild(item);
  }
}

function selectProfile(id) {
  state.selectedId = id;
  renderProfileList();
  renderServerCard();
  renderPower();
  refreshPing(id);
}

function appendLog(line) {
  state.logs.push(line);
  if (state.logs.length > 500) state.logs.shift();
  els.logOutput.textContent = state.logs.join('\n');
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

// ---- Данные ---------------------------------------------------------------

async function refreshProfiles() {
  state.profiles = await window.api.profilesList();
  renderProfileList();
  if (state.selectedId && !currentProfile()) state.selectedId = null;
  if (!state.selectedId && state.profiles.length) state.selectedId = state.profiles[0].id;
  renderServerCard();
  renderPower();
}

async function refreshCoreStatus() {
  const status = await window.api.coreStatus();
  const xrayOk = status.xray && status.tun2socks;
  els.xrayStatusText.textContent = xrayOk ? 'Установлен и готов' : 'Не установлен';
  els.installXrayBtn.textContent = xrayOk ? 'Переустановить' : 'Установить';

  if (state.platform === 'win32') {
    els.amneziaStatusText.textContent = status.amnezia
      ? 'Встроено, готово'
      : 'Не найдено — переустановите приложение';
  } else {
    // На Linux нет вшитого бинарника — статус собирается из наличия
    // системных wg-quick/awg-quick (см. src/core/coreManager.js).
    const parts = [];
    parts.push(status.wgQuickAvailable ? 'wg-quick: есть' : 'wg-quick: не найден (sudo dnf install wireguard-tools)');
    parts.push(status.awgQuickAvailable ? 'awg-quick: есть' : 'awg-quick: не найден (см. README — установка через COPR)');
    els.amneziaStatusText.textContent = parts.join(' · ');
  }
}

// ---- Настройки (сеть TUN/PROXY + поведение приложения) --------------------

function fillNetworkTab(s) {
  els.netDns1.value = s.dns1;
  els.netDns2.value = s.dns2 || '';
  els.netTunIp.value = s.tunIp;
  els.netSocksPort.value = s.socksPort;
  els.netHttpPort.value = s.httpPort;
  els.chkAutoSystemProxy.checked = !!s.autoSystemProxy;
}

function setSegActive(container, value) {
  container.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.value === value));
}

function fillGeneralTab(s) {
  setSegActive(els.defaultModeSeg, s.defaultMode);
  setSegActive(els.closeBehaviorSeg, s.closeBehavior);
  els.chkAutoConnect.checked = !!s.autoConnectLast;
  els.chkStartMinimized.checked = !!s.startMinimized;
  els.updateIntervalSelect.value = String(s.updateIntervalHours);
}

async function loadAppSettings() {
  els.netSettingsError.classList.add('hidden');
  const s = await window.api.networkSettingsGet();
  state.settings = s;
  fillNetworkTab(s);
  fillGeneralTab(s);
  setMode(s.defaultMode === 'proxy' ? 'proxy' : 'tun');
  return s;
}

if (!els.updateIntervalSelect.options.length) {
  for (const h of UPDATE_INTERVAL_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = String(h);
    opt.textContent = `Каждые ${h} ч.`;
    els.updateIntervalSelect.appendChild(opt);
  }
}

els.defaultModeSeg.addEventListener('click', async (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  setSegActive(els.defaultModeSeg, btn.dataset.value);
  const saved = await window.api.networkSettingsSave({ defaultMode: btn.dataset.value });
  state.settings = saved;
  showToast('Режим по умолчанию сохранён.', 'success');
});

els.closeBehaviorSeg.addEventListener('click', async (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  setSegActive(els.closeBehaviorSeg, btn.dataset.value);
  const saved = await window.api.networkSettingsSave({ closeBehavior: btn.dataset.value });
  state.settings = saved;
  showToast('Поведение окна сохранено.', 'success');
});

els.chkAutoConnect.addEventListener('change', async () => {
  state.settings = await window.api.networkSettingsSave({ autoConnectLast: els.chkAutoConnect.checked });
});
els.chkStartMinimized.addEventListener('change', async () => {
  state.settings = await window.api.networkSettingsSave({ startMinimized: els.chkStartMinimized.checked });
});
els.updateIntervalSelect.addEventListener('change', async () => {
  state.settings = await window.api.networkSettingsSave({ updateIntervalHours: Number(els.updateIntervalSelect.value) });
  startUpdateCheckLoop();
  showToast('Интервал проверки обновлений обновлён.', 'success');
});
els.chkAutostart.addEventListener('change', async () => {
  try {
    await window.api.autostartSet(els.chkAutostart.checked);
    showToast(els.chkAutostart.checked ? 'Автозапуск включён.' : 'Автозапуск выключен.', 'success');
  } catch (err) {
    showToast('Не удалось изменить автозапуск: ' + (err.message || err), 'error');
    els.chkAutostart.checked = !els.chkAutostart.checked;
  }
});

els.netSettingsSaveBtn.addEventListener('click', async () => {
  els.netSettingsError.classList.add('hidden');
  els.netSettingsSaveBtn.disabled = true;
  try {
    const saved = await window.api.networkSettingsSave({
      dns1: els.netDns1.value.trim(),
      dns2: els.netDns2.value.trim(),
      tunIp: els.netTunIp.value.trim(),
      socksPort: els.netSocksPort.value.trim(),
      httpPort: els.netHttpPort.value.trim(),
      autoSystemProxy: els.chkAutoSystemProxy.checked,
    });
    state.settings = saved;
    fillNetworkTab(saved);
    appendLog('Сетевые настройки сохранены — применятся при следующем подключении.');
    showToast('Сетевые настройки сохранены.', 'success');
  } catch (err) {
    els.netSettingsError.textContent = err.message || String(err);
    els.netSettingsError.classList.remove('hidden');
  } finally {
    els.netSettingsSaveBtn.disabled = false;
  }
});

els.netSettingsResetBtn.addEventListener('click', async () => {
  els.netSettingsError.classList.add('hidden');
  const defaults = await window.api.networkSettingsReset();
  state.settings = defaults;
  fillNetworkTab(defaults);
  fillGeneralTab(defaults);
  appendLog('Настройки сброшены по умолчанию.');
  showToast('Настройки сброшены по умолчанию.', 'success');
});

els.forceResetBtn.addEventListener('click', async () => {
  if (!confirm('Принудительно сбросить состояние подключения? Используйте, только если приложение зависло на "Подключение…".')) return;
  els.forceResetBtn.disabled = true;
  try {
    const status = await window.api.vpnForceReset();
    state.vpn = status;
    renderProfileList();
    renderPower();
    showToast('Состояние подключения сброшено.', 'success');
  } catch (err) {
    showToast('Не удалось сбросить: ' + (err.message || err), 'error');
  } finally {
    els.forceResetBtn.disabled = false;
  }
});

els.openUserDataBtn.addEventListener('click', () => window.api.openUserDataDir());

els.installXrayBtn.addEventListener('click', async () => {
  els.installXrayBtn.disabled = true;
  els.xrayProgress.classList.remove('hidden');
  try {
    await window.api.coreInstallXrayStack();
    await refreshCoreStatus();
    showToast('Xray-core установлен.', 'success');
  } catch (err) {
    showToast('Не удалось установить: ' + (err.message || err), 'error');
  } finally {
    els.installXrayBtn.disabled = false;
  }
});

// ---- Модалка добавления ----------------------------------------------------

function openModal() {
  els.modalName.value = '';
  els.modalText.value = '';
  els.modalError.classList.add('hidden');
  els.modalBackdrop.classList.remove('hidden');
  els.modalText.focus();
}
function closeModal() {
  els.modalBackdrop.classList.add('hidden');
}

async function saveModal() {
  const text = els.modalText.value.trim();
  const name = els.modalName.value.trim();
  if (!text) {
    els.modalError.textContent = 'Вставьте ссылку или конфиг.';
    els.modalError.classList.remove('hidden');
    return;
  }
  try {
    const result = await window.api.profilesAdd(text, name || undefined);
    await refreshProfiles();
    closeModal();
    switchView('home');
    if (result && result.multiple) {
      appendLog(`Добавлено серверов из подписки: ${result.profiles.length}.`);
      showToast(`Добавлено серверов: ${result.profiles.length}.`, 'success');
      if (result.profiles.length) selectProfile(result.profiles[0].id);
    } else {
      selectProfile(result.id);
      showToast('Сервер добавлен.', 'success');
    }
  } catch (err) {
    els.modalError.textContent = err.message || String(err);
    els.modalError.classList.remove('hidden');
  }
}

// ---- События UI -------------------------------------------------------------

els.serverCard.addEventListener('click', () => {
  if (state.profiles.length === 0) openModal();
  else switchView('servers');
});
els.addProfileBtn.addEventListener('click', openModal);

els.modalCancel.addEventListener('click', closeModal);
els.modalSave.addEventListener('click', saveModal);
els.modalBackdrop.addEventListener('click', (e) => {
  if (e.target === els.modalBackdrop) closeModal();
});

// ---- Проверка обновлений (бейдж рядом с названием) ----------------------
// Окно живёт в трее сутками (крестик прячет, не закрывает приложение, если
// не включено «Закрывать приложение» в Настройках), поэтому одной проверки
// при входе мало — перепроверяем с настраиваемым интервалом.

let updateCheckTimer = null;

function applyUpdateInfo(info) {
  state.updateInfo = info;
  const show = !!(info && info.hasUpdate);
  els.updateBadge.classList.toggle('hidden', !show);
  if (show) els.updateBadgeText.textContent = `Обновление ${info.latestVersion}`;
}

function startUpdateCheckLoop() {
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  const hours = (state.settings && state.settings.updateIntervalHours) || 6;
  const check = () => window.api.checkUpdate().then(applyUpdateInfo).catch(() => {});
  check(); // сразу, не дожидаясь первого тика интервала
  updateCheckTimer = setInterval(check, hours * 60 * 60 * 1000);
}

els.updateBadge.addEventListener('click', () => {
  if (state.updateInfo && state.updateInfo.url) window.api.openExternal(state.updateInfo.url);
});

els.relaunchAdminBtn.addEventListener('click', async () => {
  els.relaunchAdminBtn.disabled = true;
  els.relaunchAdminBtn.textContent = 'Запрашиваю UAC…';
  try {
    await window.api.relaunchElevated();
    // При успехе текущий процесс сам завершится (app.quit() в main.js).
  } catch (err) {
    showToast('Не удалось получить права администратора: ' + (err.message || err), 'error');
    els.relaunchAdminBtn.disabled = false;
    els.relaunchAdminBtn.textContent = 'Перезапустить от администратора';
  }
});

// ---- Подключение / отключение ---------------------------------------------

async function attemptConnect(profile, mode) {
  els.powerBtn.disabled = true;
  try {
    appendLog(`— Подключение к «${profile.name}» (${mode.toUpperCase()}) —`);
    await window.api.vpnConnect(profile.id, mode);
  } catch (err) {
    appendLog(`Ошибка: ${err.message || err}`);
    showToast(err.message || String(err), 'error', 7000);
  } finally {
    renderPower();
  }
}

els.powerBtn.addEventListener('click', async () => {
  const p = currentProfile();
  if (!p) {
    openModal();
    return;
  }
  if (state.vpn.state === 'connected' && state.vpn.profileId === p.id) {
    els.powerBtn.disabled = true;
    try {
      await window.api.vpnDisconnect();
    } catch (err) {
      showToast(err.message || String(err), 'error');
    } finally {
      renderPower();
    }
    return;
  }
  await attemptConnect(p, state.mode);
});

els.cancelConnectBtn.addEventListener('click', async () => {
  els.cancelConnectBtn.disabled = true;
  try {
    const status = await window.api.vpnForceReset();
    state.vpn = status;
    renderProfileList();
    renderPower();
    showToast('Подключение отменено.', 'success');
  } catch (err) {
    showToast('Не удалось отменить: ' + (err.message || err), 'error');
  } finally {
    els.cancelConnectBtn.disabled = false;
  }
});

els.clearLogBtn.addEventListener('click', () => {
  state.logs = [];
  els.logOutput.textContent = '';
});

function setProgress(barEl, receivedTotal) {
  if (!receivedTotal || !receivedTotal.total) return;
  const pct = Math.min(100, Math.round((receivedTotal.received / receivedTotal.total) * 100));
  barEl.classList.remove('hidden');
  barEl.querySelector('.progress-fill').style.width = pct + '%';
}

// ---- Подписки на события из main-процесса -----------------------------------

window.api.onVpnLog((line) => appendLog(line));

window.api.onVpnState((s) => {
  state.vpn = s;
  renderProfileList();
  renderPower();
});

window.api.onCoreProgress((progress) => {
  // AmneziaWG больше не качается в рантайме (вшит в приложение) — сюда
  // теперь долетают события только для Xray-core/tun2socks/wintun.
  const stageLabel = { xray: 'Xray-core', tun2socks: 'tun2socks', wintun: 'wintun.dll' }[progress.stage] || progress.stage;
  if (progress.phase === 'download' && progress.total) {
    setProgress(els.xrayProgress, progress);
  }
  const phaseRu = { lookup: 'поиск релиза…', download: 'загрузка…', extract: 'распаковка…', install: 'установка…', done: 'готово' }[progress.phase] || progress.phase;
  els.xrayStatusText.textContent = `${stageLabel}: ${phaseRu}`;
});

// ---- Локальный аккаунт (вход/регистрация) ---------------------------------------

function showAuthError(message) {
  els.authError.textContent = message;
  els.authError.classList.remove('hidden');
}
function hideAuthError() {
  els.authError.classList.add('hidden');
}

function showAuthScreen(status) {
  els.appRoot.classList.add('hidden');
  els.authScreen.classList.remove('hidden');
  hideAuthError();
  if (status.hasAccount) {
    els.authRegisterForm.classList.add('hidden');
    els.authLoginForm.classList.remove('hidden');
    els.loginEmailLabel.textContent = status.info ? status.info.email : '';
    els.loginPassword.value = '';
    els.loginPassword.focus();
  } else {
    els.authRegisterForm.classList.remove('hidden');
    els.authLoginForm.classList.add('hidden');
    els.regEmail.value = '';
    els.regPassword.value = '';
    els.regPassword2.value = '';
    els.regEmail.focus();
  }
}

async function refreshAccountBadge() {
  const status = await window.api.accountStatus();
  if (status.info) {
    els.accountEmail.textContent = status.info.email;
    els.accountIdText.textContent = `Локальный ID: ${status.info.id}`;
  }
}

els.registerBtn.addEventListener('click', async () => {
  hideAuthError();
  const email = els.regEmail.value.trim();
  const password = els.regPassword.value;
  const password2 = els.regPassword2.value;
  if (!email) return showAuthError('Укажите email.');
  if (password.length < 4) return showAuthError('Пароль должен быть не короче 4 символов.');
  if (password !== password2) return showAuthError('Пароли не совпадают.');
  try {
    await window.api.accountRegister(email, password);
    await afterUnlock();
  } catch (err) {
    showAuthError(err.message || String(err));
  }
});

els.loginBtn.addEventListener('click', async () => {
  hideAuthError();
  try {
    await window.api.accountLogin(els.loginPassword.value);
    await afterUnlock();
  } catch (err) {
    showAuthError(err.message || String(err));
  }
});
els.loginPassword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.loginBtn.click();
});

els.resetAccountBtn.addEventListener('click', async () => {
  const sure = confirm(
    'Это удалит локальный аккаунт и ВСЕ сохранённые серверы на этом компьютере — их нельзя будет восстановить. Продолжить?'
  );
  if (!sure) return;
  await window.api.accountReset();
  const status = await window.api.accountStatus();
  showAuthScreen(status);
});

els.logoutBtn.addEventListener('click', async () => {
  clearInterval(updateCheckTimer);
  updateCheckTimer = null;
  await window.api.accountLogout();
  switchView('home');
  const status = await window.api.accountStatus();
  showAuthScreen(status);
});

// ---- Инициализация -------------------------------------------------------------

async function afterUnlock() {
  els.authScreen.classList.add('hidden');
  els.appRoot.classList.remove('hidden');

  await refreshAccountBadge();

  const info = await window.api.appInfo();
  state.platform = info.platform;
  els.versionText.textContent = `v${info.version}`;
  els.aboutVersionText.textContent = `My List VPN, версия ${info.version}`;

  // На Linux нет единого системного прокси, который стоило бы переключать
  // автоматически (см. src/platform/linux/proxySystem.js) — прячем тумблер
  // и показываем вместо него пояснение, что адрес нужно прописать вручную.
  if (state.platform !== 'win32') {
    els.autoSystemProxyRow.classList.add('hidden');
    els.linuxProxyHint.classList.remove('hidden');
  }

  state.elevated = await window.api.elevationStatus();
  els.adminBanner.classList.toggle('hidden', state.elevated);

  state.vpn = await window.api.vpnStatus();
  await loadAppSettings();

  // Не блокирует запуск — бейдж появится, когда (и если) придёт ответ.
  startUpdateCheckLoop();

  await refreshProfiles();
  await refreshCoreStatus();

  if (state.vpn.profileId) {
    selectProfile(state.vpn.profileId);
    if (state.vpn.mode) setMode(state.vpn.mode);
  } else if (state.profiles.length) {
    selectProfile(state.profiles[0].id);
  }

  // Автоподключение к последнему серверу (если включено и мы ещё не подключены).
  if (
    state.settings &&
    state.settings.autoConnectLast &&
    state.settings.lastProfileId &&
    state.vpn.state === 'disconnected'
  ) {
    const p = state.profiles.find((x) => x.id === state.settings.lastProfileId);
    if (p) {
      selectProfile(p.id);
      const mode = state.settings.lastMode === 'proxy' && p.type !== 'wireguard' ? 'proxy' : 'tun';
      setMode(mode);
      attemptConnect(p, mode);
    }
  }
}

async function init() {
  const status = await window.api.accountStatus();
  if (!status.unlocked) {
    showAuthScreen(status);
    return;
  }
  await afterUnlock();
}

init();
