'use strict';
/**
 * Единая точка выбора платформенной реализации. Всё, что реально отличается
 * между Windows и Linux (права, маршрутизация, WireGuard-бэкенд, системный
 * прокси), спрятано за одним и тем же интерфейсом в ./win и ./linux —
 * остальной код (tunController.js, xrayEngine.js, wgEngine.js,
 * proxyManager.js, core/elevation.js) вызывает src/platform и не знает, на
 * какой ОС выполняется.
 *
 * macOS и прочее сознательно не поддерживаются — понятная ошибка при старте
 * вместо непонятного краша посреди попытки подключения.
 */
const SUPPORTED = { win32: './win', linux: './linux' };

const modPath = SUPPORTED[process.platform];
if (!modPath) {
  throw new Error(
    `My List VPN не поддерживает платформу "${process.platform}" — реализованы только Windows (win32) и Linux.`
  );
}

module.exports = require(modPath);
