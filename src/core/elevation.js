'use strict';
/**
 * Тонкий диспетчер: вся реальная логика прав администратора/root — в
 * src/platform/{win,linux}/elevation.js (см. src/platform/index.js). Этот
 * файл оставлен как стабильная точка входа, чтобы main.js и остальной код
 * не знали о существовании src/platform.
 */
module.exports = require('../platform').elevation;
