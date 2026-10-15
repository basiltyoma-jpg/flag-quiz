/**
 * Упаковка сигналов WebRTC в короткий код.
 *
 * Сайт статический, сервера для знакомства браузеров нет, поэтому игроки
 * обмениваются кодами вручную: хост присылает код-приглашение, гость — код-ответ.
 * Внутри кода лежит SDP целиком, поэтому его сжимаем и переводим в base64url
 * (в коде нет «+», «/» и «=» — такие коды не ломаются в мессенджерах).
 *
 * Формат: GW1<метод><данные>
 *   z — данные сжаты (deflate-raw), код короче;
 *   p — данные без сжатия (браузер не умеет CompressionStream).
 */
'use strict';

const SIGNAL_VERSION = 'GW1';
const SIGNAL_MAX_LENGTH = 20000;
const SIGNAL_DEFLATE = 'z';
const SIGNAL_PLAIN = 'p';

/** Байты → base64url. */
function bytesToBase64Url(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** base64url → байты. */
function base64UrlToBytes(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Прокачивает байты через TransformStream и собирает результат. */
async function transformBytes(bytes, transform) {
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const result = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

/** Сжимает байты deflate-raw. Возвращает null, если браузер этого не умеет. */
async function deflateBytes(bytes) {
  if (typeof CompressionStream !== 'function') {
    return null;
  }
  try {
    return await transformBytes(bytes, new CompressionStream('deflate-raw'));
  } catch (error) {
    return null;
  }
}

/** Разворачивает deflate-raw. */
async function inflateBytes(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Браузер не умеет разжимать код приглашения — обновите его');
  }
  return transformBytes(bytes, new DecompressionStream('deflate-raw'));
}

/** Упаковывает сигнал WebRTC (описание соединения) в код для пересылки человеку. */
async function packSignal(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const compressed = await deflateBytes(bytes);
  return compressed
    ? SIGNAL_VERSION + SIGNAL_DEFLATE + bytesToBase64Url(compressed)
    : SIGNAL_VERSION + SIGNAL_PLAIN + bytesToBase64Url(bytes);
}

/** Разбирает код приглашения, проверяя формат. */
async function unpackSignal(code) {
  const text = String(code == null ? '' : code).replace(/\s+/g, '');
  if (text.length < SIGNAL_VERSION.length + 2) {
    throw new Error('Код приглашения пустой');
  }
  if (!text.startsWith(SIGNAL_VERSION)) {
    throw new Error('Это не код приглашения: проверьте, что скопирован весь текст');
  }
  if (text.length > SIGNAL_MAX_LENGTH) {
    throw new Error('Код приглашения слишком длинный');
  }
  const format = text.charAt(SIGNAL_VERSION.length);
  const data = text.slice(SIGNAL_VERSION.length + 1);

  let json;
  if (format === SIGNAL_DEFLATE) {
    json = new TextDecoder().decode(await inflateBytes(base64UrlToBytes(data)));
  } else if (format === SIGNAL_PLAIN) {
    json = new TextDecoder().decode(base64UrlToBytes(data));
  } else {
    throw new Error('Неизвестный формат кода приглашения');
  }

  let payload;
  try {
    payload = JSON.parse(json);
  } catch (error) {
    throw new Error('Код приглашения повреждён — скопируйте его заново');
  }
  if (!payload || typeof payload !== 'object' || typeof payload.sdp !== 'string' || !payload.sdp) {
    throw new Error('В коде приглашения нет данных соединения');
  }
  return payload;
}
