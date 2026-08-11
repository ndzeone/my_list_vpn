'use strict';

const state = {
  profiles: [],
  selectedId: null,
  vpn: { state: 'disconnected', profileId: null, connectedSince: null },
  logs: [],
  elevated: true,
  pings: {}, // id -> ms|null
  updateInfo: null,
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

  settingsBtn: el('settingsBtn'),

  powerBtn: el('powerBtn'),
  ringPulse: el('ringPulse'),
  statusText: el('statusText'),
  statusSub: el('statusSub'),

  serverCard: el('serverCard'),
  serverTypeBadge: el('serverTypeBadge'),
  serverCardName: el('serverCardName'),
  serverCardSub: el('serverCardSub'),
  serverCardPing: el('serverCardPing'),

  logOutput: el('logOutput'),
  clearLogBtn: el('clearLogBtn'),

  serverPanelBackdrop: el('serverPanelBackdrop'),
  closeServerPanel: el('closeServerPanel'),
  addProfileBtn: el('addProfileBtn'),
  profileList: el('profileList'),

  settingsPanelBackdrop: el('settingsPanelBackdrop'),
  closeSettingsPanel: el('closeSettingsPanel'),

  netDns1: el('netDns1'),
  netDns2: el('netDns2'),
  netTunIp: el('netTunIp'),
  netSocksPort: el('netSocksPort'),
  netSettingsError: el('netSettingsError'),
  netSettingsSaveBtn: el('netSettingsSaveBtn'),
  netSettingsResetBtn: el('netSettingsResetBtn'),

  xrayStatusText: el('xrayStatusText'),
  installXrayBtn: el('installXrayBtn'),
  xrayProgress: el('xrayProgress'),
  amneziaStatusText: el('amneziaStatusText'),
  versionText: el('versionText'),

  modalBackdrop: el('modalBackdrop'),
  modalName: el('modalName'),
  modalText: el('modalText'),
  modalError: el('modalError'),
  modalCancel: el('modalCancel'),
  modalSave: el('modalSave'),
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

// ---- Рендер верхней карточки (главный экран) --------------------------

function renderServerCard() {
  const p = currentProfile();
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

  els.powerBtn.className = 'power-btn';
  els.ringPulse.classList.remove('active');
  els.powerBtn.disabled = false;

  if (s === 'connected') {
    els.powerBtn.classList.add('connected');
    els.statusText.textContent = 'Подключено';
    els.statusSub.textContent = '';
  } else if (s === 'connecting') {
    els.powerBtn.classList.add('connecting');
    els.ringPulse.classList.add('active');
    els.statusText.textContent = 'Подключение…';
    els.statusSub.textContent = 'Настраиваю TUN-адаптер и маршруты';
    els.powerBtn.disabled = true;
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

  clearInterval(uptimeTimer);
  if (s === 'connected' && state.vpn.connectedSince) {
    const tick = () => (els.statusSub.textContent = fmtUptime(Date.now() - state.vpn.connectedSince));
    tick();
    uptimeTimer = setInterval(tick, 1000);
  }
}

// ---- Список серверов (панель) ------------------------------------------

function renderProfileList() {
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
      closeServerPanel();
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

// ---- Панели --------------------------------------------------------------

function openServerPanel() {
  els.serverPanelBackdrop.classList.remove('hidden');
}
function closeServerPanel() {
  els.serverPanelBackdrop.classList.add('hidden');
}
async function openSettingsPanel() {
  els.settingsPanelBackdrop.classList.remove('hidden');
  await refreshCoreStatus();
  await loadNetworkSettings();
}
function closeSettingsPanel() {
  els.settingsPanelBackdrop.classList.add('hidden');
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

  els.amneziaStatusText.textContent = status.amnezia
    ? 'Встроено, готово'
    : 'Не найдено — переустановите приложение';
}

// ---- Сетевые настройки TUN (DNS/IP/порт) -------------------------------

function fillNetworkInputs(s) {
  els.netDns1.value = s.dns1;
  els.netDns2.value = s.dns2 || '';
  els.netTunIp.value = s.tunIp;
  els.netSocksPort.value = s.socksPort;
}

async function loadNetworkSettings() {
  els.netSettingsError.classList.add('hidden');
  const s = await window.api.networkSettingsGet();
  fillNetworkInputs(s);
}

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
    closeServerPanel();
    if (result && result.multiple) {
      appendLog(`Добавлено серверов из подписки: ${result.profiles.length}.`);
      if (result.profiles.length) selectProfile(result.profiles[0].id);
    } else {
      selectProfile(result.id);
    }
  } catch (err) {
    els.modalError.textContent = err.message || String(err);
    els.modalError.classList.remove('hidden');
  }
}

// ---- События UI -------------------------------------------------------------

els.serverCard.addEventListener('click', () => {
  if (state.profiles.length === 0) openModal();
  else openServerPanel();
});
els.closeServerPanel.addEventListener('click', closeServerPanel);
els.serverPanelBackdrop.addEventListener('click', (e) => {
  if (e.target === els.serverPanelBackdrop) closeServerPanel();
});
els.addProfileBtn.addEventListener('click', openModal);

els.settingsBtn.addEventListener('click', openSettingsPanel);
els.closeSettingsPanel.addEventListener('click', closeSettingsPanel);
els.settingsPanelBackdrop.addEventListener('click', (e) => {
  if (e.target === els.settingsPanelBackdrop) closeSettingsPanel();
});

els.modalCancel.addEventListener('click', closeModal);
els.modalSave.addEventListener('click', saveModal);
els.modalBackdrop.addEventListener('click', (e) => {
  if (e.target === els.modalBackdrop) closeModal();
});

// ---- Проверка обновлений (бейдж рядом с названием) ----------------------

function applyUpdateInfo(info) {
  state.updateInfo = info;
  const show = !!(info && info.hasUpdate);
  els.updateBadge.classList.toggle('hidden', !show);
  if (show) els.updateBadgeText.textContent = `Обновление ${info.latestVersion}`;
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
    alert('Не удалось получить права администратора: ' + (err.message || err));
    els.relaunchAdminBtn.disabled = false;
    els.relaunchAdminBtn.textContent = 'Перезапустить от администратора';
  }
});

els.powerBtn.addEventListener('click', async () => {
  const p = currentProfile();
  if (!p) {
    openModal();
    return;
  }
  els.powerBtn.disabled = true;
  try {
    if (state.vpn.state === 'connected' && state.vpn.profileId === p.id) {
      await window.api.vpnDisconnect();
    } else {
      appendLog(`— Подключение к «${p.name}» —`);
      await window.api.vpnConnect(p.id);
    }
  } catch (err) {
    appendLog(`Ошибка: ${err.message || err}`);
    alert(err.message || String(err));
  } finally {
    renderPower();
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

els.netSettingsSaveBtn.addEventListener('click', async () => {
  els.netSettingsError.classList.add('hidden');
  els.netSettingsSaveBtn.disabled = true;
  try {
    const saved = await window.api.networkSettingsSave({
      dns1: els.netDns1.value.trim(),
      dns2: els.netDns2.value.trim(),
      tunIp: els.netTunIp.value.trim(),
      socksPort: els.netSocksPort.value.trim(),
    });
    fillNetworkInputs(saved);
    appendLog('Сетевые настройки TUN сохранены — применятся при следующем подключении.');
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
  fillNetworkInputs(defaults);
  appendLog('Сетевые настройки TUN сброшены по умолчанию.');
});

els.installXrayBtn.addEventListener('click', async () => {
  els.installXrayBtn.disabled = true;
  els.xrayProgress.classList.remove('hidden');
  try {
    await window.api.coreInstallXrayStack();
    await refreshCoreStatus();
  } catch (err) {
    alert('Не удалось установить: ' + (err.message || err));
  } finally {
    els.installXrayBtn.disabled = false;
  }
});

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
  await window.api.accountLogout();
  closeSettingsPanel();
  closeServerPanel();
  const status = await window.api.accountStatus();
  showAuthScreen(status);
});

// ---- Инициализация -------------------------------------------------------------

async function afterUnlock() {
  els.authScreen.classList.add('hidden');
  els.appRoot.classList.remove('hidden');

  await refreshAccountBadge();

  const info = await window.api.appInfo();
  els.versionText.textContent = `Версия ${info.version}`;

  state.elevated = await window.api.elevationStatus();
  els.adminBanner.classList.toggle('hidden', state.elevated);

  state.vpn = await window.api.vpnStatus();

  // Не блокирует запуск — бейдж появится, когда (и если) придёт ответ.
  window.api.checkUpdate().then(applyUpdateInfo).catch(() => {});

  await refreshProfiles();
  await refreshCoreStatus();

  if (state.vpn.profileId) selectProfile(state.vpn.profileId);
  else if (state.profiles.length) selectProfile(state.profiles[0].id);
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
