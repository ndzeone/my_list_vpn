'use strict';
/**
 * Хранилище профилей (список серверов пользователя). Файл на диске хранит
 * не сам список, а его AES-256-GCM шифротекст — ключ передаётся снаружи
 * (это ключ, производный от пароля локального аккаунта, см. accountStore).
 * Без разблокированного аккаунта содержимое профилей нечитаемо даже при
 * прямом доступе к файлу.
 */
const fs = require('fs');
const crypto = require('crypto');
const paths = require('../core/paths');

function loadAll(key) {
  const file = paths.getProfilesFile();
  if (!fs.existsSync(file)) return [];
  try {
    const blob = JSON.parse(fs.readFileSync(file, 'utf8'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(blob.tag, 'hex'));
    const plain = Buffer.concat([decipher.update(Buffer.from(blob.data, 'hex')), decipher.final()]).toString('utf8');
    const data = JSON.parse(plain);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('Не удалось расшифровать profiles.json (неверный ключ или повреждён файл):', err);
    return [];
  }
}

function saveAll(profiles, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(profiles), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = { iv: iv.toString('hex'), data: ciphertext.toString('hex'), tag: tag.toString('hex') };
  fs.writeFileSync(paths.getProfilesFile(), JSON.stringify(blob), 'utf8');
}

function add(profile, key) {
  const profiles = loadAll(key);
  const entry = Object.assign(
    {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    },
    profile
  );
  profiles.push(entry);
  saveAll(profiles, key);
  return entry;
}

function remove(id, key) {
  const profiles = loadAll(key).filter((p) => p.id !== id);
  saveAll(profiles, key);
}

function update(id, patch, key) {
  const profiles = loadAll(key);
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  profiles[idx] = Object.assign({}, profiles[idx], patch);
  saveAll(profiles, key);
  return profiles[idx];
}

function getById(id, key) {
  return loadAll(key).find((p) => p.id === id) || null;
}

module.exports = { loadAll, saveAll, add, remove, update, getById };
