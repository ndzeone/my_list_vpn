'use strict';
/**
 * Тонкий диспетчер: реальная логика системного прокси — в
 * src/platform/{win,linux}/proxySystem.js (Windows — реестр Internet
 * Settings; Linux — только показывает адрес, см. решение в плане). Файл
 * оставлен как стабильная точка входа для tunController.js.
 */
module.exports = require('../platform').proxySystem;
