'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  appInfo: () => ipcRenderer.invoke('app:info'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),

  accountStatus: () => ipcRenderer.invoke('account:status'),
  accountRegister: (email, password) => ipcRenderer.invoke('account:register', { email, password }),
  accountLogin: (password) => ipcRenderer.invoke('account:login', { password }),
  accountLogout: () => ipcRenderer.invoke('account:logout'),
  accountReset: () => ipcRenderer.invoke('account:reset'),

  elevationStatus: () => ipcRenderer.invoke('elevation:status'),
  relaunchElevated: () => ipcRenderer.invoke('elevation:relaunch'),

  profilesList: () => ipcRenderer.invoke('profiles:list'),
  profilesAdd: (text, name) => ipcRenderer.invoke('profiles:add', { text, name }),
  profilesRemove: (id) => ipcRenderer.invoke('profiles:remove', id),
  profilesRename: (id, name) => ipcRenderer.invoke('profiles:rename', { id, name }),
  profilesPing: (id) => ipcRenderer.invoke('profiles:ping', id),

  coreStatus: () => ipcRenderer.invoke('core:status'),
  coreInstallXrayStack: () => ipcRenderer.invoke('core:installXrayStack'),
  onCoreProgress: (cb) => {
    const listener = (evt, payload) => cb(payload);
    ipcRenderer.on('core:progress', listener);
    return () => ipcRenderer.removeListener('core:progress', listener);
  },

  vpnConnect: (id) => ipcRenderer.invoke('vpn:connect', id),
  vpnDisconnect: () => ipcRenderer.invoke('vpn:disconnect'),
  vpnStatus: () => ipcRenderer.invoke('vpn:status'),
  onVpnLog: (cb) => {
    const listener = (evt, line) => cb(line);
    ipcRenderer.on('vpn:log', listener);
    return () => ipcRenderer.removeListener('vpn:log', listener);
  },
  onVpnState: (cb) => {
    const listener = (evt, state) => cb(state);
    ipcRenderer.on('vpn:state', listener);
    return () => ipcRenderer.removeListener('vpn:state', listener);
  },

  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
});
