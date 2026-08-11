'use strict';
/**
 * Оркестратор подключения: выбирает нужный движок по типу профиля,
 * следит за состоянием (disconnected/connecting/connected/disconnecting)
 * и не даёт запустить два туннеля одновременно.
 */
const profileStore = require('../store/profileStore');
const coreManager = require('../core/coreManager');
const xrayEngine = require('./xrayEngine');
const wgEngine = require('./wgEngine');

class TunController {
  constructor() {
    this.state = 'disconnected';
    this.activeProfileId = null;
    this.activeEngine = null;
    this.connectedSince = null;
  }

  getStatus() {
    return {
      state: this.state,
      profileId: this.activeProfileId,
      connectedSince: this.connectedSince,
    };
  }

  async connect(profileId, key, { onLog, onState } = {}) {
    if (this.state !== 'disconnected') {
      throw new Error('Уже есть активное или незавершённое подключение.');
    }
    const profile = profileStore.getById(profileId, key);
    if (!profile) throw new Error('Профиль не найден.');

    this._setState('connecting', onState);
    try {
      if (profile.type === 'vless' || profile.type === 'trojan') {
        const st = coreManager.status();
        if (!st.xray || !st.tun2socks) {
          throw new Error('Движок Xray/tun2socks не установлен. Откройте раздел «Движки» и установите его.');
        }
        await xrayEngine.start(profile, { onLog });
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
      this.connectedSince = Date.now();
      this._setState('connected', onState);
    } catch (err) {
      this.activeEngine = null;
      this.activeProfileId = null;
      this.connectedSince = null;
      this._setState('disconnected', onState);
      throw err;
    }
  }

  async disconnect({ onLog, onState } = {}) {
    if (this.state !== 'connected') return;
    this._setState('disconnecting', onState);
    try {
      if (this.activeEngine) await this.activeEngine.stop({ onLog });
    } finally {
      this.activeEngine = null;
      this.activeProfileId = null;
      this.connectedSince = null;
      this._setState('disconnected', onState);
    }
  }

  _setState(state, onState) {
    this.state = state;
    onState && onState(this.getStatus());
  }
}

module.exports = new TunController();
