'use strict';
/**
 * Локальный аккаунт: единственная его задача — превратить пароль в ключ
 * шифрования для profiles.json (см. profileStore.js). Никакого сервера,
 * никакой отправки данных наружу — всё живёт в userData на этом же
 * компьютере.
 *
 * Важно: пароль нельзя восстановить. Он не хранится — хранится только
 * соль и «проверочный» шифротекст, по которому при входе проверяется,
 * что введённый пароль порождает тот же ключ. Если пароль забыт,
 * единственный выход — accountReset() (полное удаление аккаунта и
 * сохранённых серверов).
 */
const fs = require('fs');
const crypto = require('crypto');
const paths = require('../core/paths');

function hasAccount() {
  return fs.existsSync(paths.getAccountFile());
}

function readAccountRaw() {
  return JSON.parse(fs.readFileSync(paths.getAccountFile(), 'utf8'));
}

function deriveKey(password, saltHex) {
  return crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
}

function makeCheck(key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update('ok', 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), data: data.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
}

function verifyCheck(key, check) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(check.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(check.tag, 'hex'));
    const plain = Buffer.concat([decipher.update(Buffer.from(check.data, 'hex')), decipher.final()]).toString('utf8');
    return plain === 'ok';
  } catch (err) {
    return false;
  }
}

function createAccount(email, password) {
  if (hasAccount()) throw new Error('Локальный аккаунт уже создан.');
  if (!email || !email.trim()) throw new Error('Укажите email.');
  if (!password || password.length < 4) throw new Error('Пароль должен быть не короче 4 символов.');

  const salt = crypto.randomBytes(16);
  const key = deriveKey(password, salt.toString('hex'));

  const account = {
    email: email.trim(),
    id: crypto.randomBytes(4).readUInt32BE(0).toString().padStart(6, '0').slice(-6),
    createdAt: Date.now(),
    salt: salt.toString('hex'),
    check: makeCheck(key),
  };
  fs.writeFileSync(paths.getAccountFile(), JSON.stringify(account, null, 2), 'utf8');

  // Инициализируем пустой (но уже зашифрованный новым ключом) список серверов.
  const profileStore = require('./profileStore');
  profileStore.saveAll([], key);

  return { email: account.email, id: account.id, createdAt: account.createdAt, key };
}

function login(password) {
  if (!hasAccount()) throw new Error('Аккаунт ещё не создан.');
  const account = readAccountRaw();
  const key = deriveKey(password || '', account.salt);
  if (!verifyCheck(key, account.check)) {
    throw new Error('Неверный пароль.');
  }
  return { email: account.email, id: account.id, createdAt: account.createdAt, key };
}

function getPublicInfo() {
  if (!hasAccount()) return null;
  const a = readAccountRaw();
  return { email: a.email, id: a.id, createdAt: a.createdAt };
}

/**
 * Полный сброс: удаляет аккаунт и сохранённые (зашифрованные, а значит и
 * так нечитаемые без пароля) конфиги. Единственный путь "забыл пароль".
 */
function resetAccount() {
  for (const file of [paths.getAccountFile(), paths.getProfilesFile()]) {
    try {
      fs.unlinkSync(file);
    } catch (err) {
      // файла и не было — ок
    }
  }
}

module.exports = { hasAccount, createAccount, login, getPublicInfo, resetAccount };
