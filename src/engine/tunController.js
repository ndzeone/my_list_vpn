'use strict';
/**
 * Оркестратор подключения: выбирает нужный движок и режим по типу профиля
 * (TUN — весь трафик ОС через системный адаптер, PROXY — только локальный
 * SOCKS/HTTP + опционально системный прокси Windows), следит за состоянием
 * (disconnected/connecting/connected/disconnecting) и не даёт запустить два
 * туннеля одновременно.
 */
const profileStore = require('../store/profileStore');
const settingsStore = require('../store/settingsStore');
const coreManager = require('../core/coreManager');
const xrayEngine = require('./xrayEngine');
const wgEngine = require('./wgEngine');
const proxyManager = require('./proxyManager');

class TunController {
  constructor() {
    this.state = 'disconnected';
    this.activeProfileId = null;
    this.activeEngine = null;
    this.activeMode = null;
    this.systemProxyActive = false;
    this.connectedSince = null;
  }

  getStatus() {
    return {
      state: this.state,
      profileId: this.activeProfileId,
      mode: this.activeMode,
      connectedSince: this.connectedSince,
    };
  }

  async connect(profileId, key, mode, { onLog, onState } = {}) {
    if (this.state !== 'disconnected') {
      throw new Error(
        this.state === 'connecting'
          ? 'Подключение уже выполняется — подождите либо нажмите «Отменить». Если оно зависло надолго, сбросьте состояние в Настройки → Диагностика.'
          : 'Уже есть активное подключение — сначала отключитесь.'
      );
    }
    const requestedMode = mode === 'proxy' ? 'proxy' : 'tun';
    const profile = profileStore.getById(profileId, key);
    if (!profile) throw new Error('Профиль не найден.');
    if (requestedMode === 'proxy' && profile.type === 'wireguard') {
      throw new Error('WireGuard/AmneziaWG поддерживает только режим TUN — у прокси нет понятия «весь трафик».');
    }

    this._setState('connecting', onState);
    try {
      if (profile.type === 'vless' || profile.type === 'trojan') {
        const st = coreManager.status();
        if (!st.xray || !st.tun2socks) {
          throw new Error('Движок Xray/tun2socks не установлен. Откройте раздел «Движки» и установите его.');
        }
        if (requestedMode === 'tun') {
          await xrayEngine.startTun(profile, { onLog });
        } else {
          await xrayEngine.startProxy(profile, { onLog });
          const net = settingsStore.load();
          if (net.autoSystemProxy) {
            await proxyManager.enableSystemProxy(net.httpPort, net.socksPort, { onLog });
            this.systemProxyActive = true;
          }
        }
        this.activeEngine = xrayEngine;
      } else if (profile.type === 'wireguard') {
        const st = coreManager.status();
        if (!st.amnezia) {
          throw new Error('Встроенный amneziawg.exe не найден — похоже, установка приложения повреждена. Переустановите программу.');
        }
        await wgEngine.start(profile, { onLog });
        this.activeEngine = wgEngine;
      } else {
        throw new Error(`Неизвестный тип профиля: ${profile.type}`);
      }
      this.activeProfileId = profileId;
      this.activeMode = requestedMode;
      this.connectedSince = Date.now();
      settingsStore.save({ lastProfileId: profileId, lastMode: requestedMode });
      this._setState('connected', onState);
    } catch (err) {
      await this._cleanupAfterFailure(onLog);
      this.activeEngine = null;
      this.activeProfileId = null;
      this.activeMode = null;
      this.connectedSince = null;
      this._setState('disconnected', onState);
      throw err;
    }
  }

  async _cleanupAfterFailure(onLog) {
    // Если упали на середине (например, xray поднялся, а tun2socks — нет),
    // не оставляем процессы висеть до следующей попытки.
    try {
      if (xrayEngine.isRunning) await xrayEngine.stop({ onLog });
    } catch (err) {
      onLog && onLog(`(не критично) ошибка при откате после неудачного подключения: ${err.message}`);
    }
    if (this.systemProxyActive) {
      try {
        await proxyManager.disableSystemProxy({ onLog });
      } catch (err) {
        onLog && onLog(`(не критично) не удалось откатить системный прокси: ${err.message}`);
      }
      this.systemProxyActive = false;
    }
  }

  async disconnect({ onLog, onState } = {}) {
    if (this.state !== 'connected') return;
    this._setState('disconnecting', onState);
    try {
      if (this.activeEngine) await this.activeEngine.stop({ onLog });
      if (this.systemProxyActive) {
        await proxyManager.disableSystemProxy({ onLog });
        this.systemProxyActive = false;
      }
    } finally {
      this.activeEngine = null;
      this.activeProfileId = null;
      this.activeMode = null;
      this.connectedSince = null;
      this._setState('disconnected', onState);
    }
  }

  /**
   * Аварийный сброс: используется, когда connect()/disconnect() зависли
   * (несмотря на таймауты внутри движков) и обычная кнопка не помогает.
   * Жёстко останавливает всё, что может быть запущено, и форсит состояние
   * в disconnected — не дожидаясь штатного завершения предыдущей попытки.
   */
  async forceReset({ onLog, onState } = {}) {
    const log = (line) => onLog && onLog(line);
    log('Принудительный сброс состояния подключения...');
    await this._cleanupAfterFailure(onLog);
    try {
      if (wgEngine.isRunning) await wgEngine.stop({ onLog });
    } catch (err) {
      log(`(не критично) ошибка при остановке WireGuard/AmneziaWG: ${err.message}`);
    }
    this.activeEngine = null;
    this.activeProfileId = null;
    this.activeMode = null;
    this.connectedSince = null;
    this.systemProxyActive = false;
    this._setState('disconnected', onState);
    log('Готово — состояние сброшено в «Отключено».');
  }

  _setState(state, onState) {
    this.state = state;
    onState && onState(this.getStatus());
  }
}

module.exports = new TunController();
