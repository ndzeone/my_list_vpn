'use strict';
/**
 * На Linux нет единого системного прокси, который стоило бы трогать
 * автоматически: GNOME хранит его в gsettings, KDE — в своих настройках,
 * на Fedora Server GUI вообще нет, а многие приложения (терминал, curl,
 * консольные тулы) используют переменные окружения http_proxy/https_proxy,
 * которые нельзя выставить процессу, который уже запущен. Автоматическое
 * переключение здесь было бы либо неполным, либо ломало бы что-то помимо
 * браузера — поэтому по решению пользователя режим PROXY на Linux просто
 * поднимает локальный SOCKS/HTTP (см. xrayEngine.js) и показывает адрес,
 * который нужно прописать вручную в браузере/приложении.
 */
async function enableSystemProxy(httpPort, socksPort, { onLog } = {}) {
  const log = (line) => onLog && onLog(line);
  log(
    `Автовключение системного прокси на Linux не выполняется. Настройте вручную: ` +
      `SOCKS5 127.0.0.1:${socksPort}, HTTP/HTTPS 127.0.0.1:${httpPort} ` +
      `(GNOME: Настройки → Сеть → Прокси-сервер сети; либо переменные http_proxy/https_proxy/all_proxy для терминала).`
  );
}

async function disableSystemProxy({ onLog } = {}) {
  // Ничего не включали автоматически — нечего и откатывать.
}

module.exports = { enableSystemProxy, disableSystemProxy };
