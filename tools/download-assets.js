/**
 * Загружает изображения для игры и создаёт манифест доступных файлов.
 *
 * Запуск (нужен Node.js 18+ и интернет):
 *     node tools/download-assets.js
 *
 * Что делает:
 *   1. читает список стран из js/data.js;
 *   2. скачивает флаг   -> assets/flags/<code>.svg   (https://flagcdn.com)
 *   3. скачивает контур -> assets/shapes/<code>.svg  (mapsicon, potrace-SVG);
 *      чёрный силуэт перекрашивается в светлый цвет для тёмной темы;
 *   4. пишет js/assets.js — сколько стран реально имеют картинку.
 *
 * Отсутствующие (404) изображения просто пропускаются: такие страны не будут
 * попадаться в соответствующем режиме игры.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FLAG_DIR = path.join(ROOT, 'assets', 'flags');
const SHAPE_DIR = path.join(ROOT, 'assets', 'shapes');
const MANIFEST = path.join(ROOT, 'js', 'assets.js');
const SHAPE_FILL = '#dbe4ff';
const CONCURRENCY = 8;

const flagUrl = (code) => `https://flagcdn.com/${code}.svg`;
const shapeUrl = (code) =>
  `https://raw.githubusercontent.com/djaiss/mapsicon/master/all/${code}/vector.svg`;

/** Читает COUNTRIES из js/data.js, выполняя файл в песочнице. */
function loadCountries() {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8');
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(source + '\nthis.__countries = COUNTRIES;', sandbox);
  return sandbox.__countries;
}

/** Скачивает SVG и проверяет, что это действительно картинка. */
async function fetchSvg(url, needPath, transform) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  let buffer = Buffer.from(await response.arrayBuffer());
  let text = buffer.toString('utf8');
  if (!text.includes('<svg') || (needPath && !text.includes('<path'))) {
    throw new Error('не похоже на SVG');
  }
  if (transform) {
    text = transform(text);
    buffer = Buffer.from(text, 'utf8');
  }
  return buffer;
}

async function downloadOne(code, result) {
  try {
    const flag = await fetchSvg(flagUrl(code), false);
    fs.writeFileSync(path.join(FLAG_DIR, `${code}.svg`), flag);
    result.flags[code] = flag.length;
  } catch (error) {
    result.missingFlags.push(`${code} (${error.message})`);
  }

  try {
    const shape = await fetchSvg(shapeUrl(code), true, (text) =>
      text.split('#000000').join(SHAPE_FILL)
    );
    fs.writeFileSync(path.join(SHAPE_DIR, `${code}.svg`), shape);
    result.shapes[code] = shape.length;
  } catch (error) {
    result.missingShapes.push(`${code} (${error.message})`);
  }
}

/** Простой пул: не больше CONCURRENCY одновременных запросов. */
async function runPool(items, worker) {
  const queue = items.slice();
  const workers = [];
  for (let i = 0; i < CONCURRENCY; i += 1) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          await worker(queue.shift());
        }
      })()
    );
  }
  await Promise.all(workers);
}

/** Возвращает объект с ключами по алфавиту — так файл манифеста стабилен. */
function sortByKey(source) {
  const sorted = {};
  Object.keys(source)
    .sort()
    .forEach((key) => {
      sorted[key] = source[key];
    });
  return sorted;
}

function writeManifest(flags, shapes) {
  const body = JSON.stringify({ flags: sortByKey(flags), shapes: sortByKey(shapes) }, null, 2);
  const text = `/**
 * Манифест доступных изображений: код страны -> размер файла в байтах.
 * Файл создан автоматически командой "node tools/download-assets.js".
 * Если запустить игру без него или удалить картинки, они не будут показываться.
 */
const AVAILABLE = ${body};
`;
  fs.writeFileSync(MANIFEST, text, 'utf8');
}

async function main() {
  fs.mkdirSync(FLAG_DIR, { recursive: true });
  fs.mkdirSync(SHAPE_DIR, { recursive: true });

  const countries = loadCountries();
  const result = { flags: {}, shapes: {}, missingFlags: [], missingShapes: [] };

  console.log(`скачиваю ${countries.length} стран...`);
  await runPool(
    countries.map((country) => country.code),
    (code) => downloadOne(code, result)
  );

  writeManifest(result.flags, result.shapes);

  const levelNames = ['easy', 'medium', 'hard', 'impossible'];
  console.log('');
  console.log(`флаги:   ${Object.keys(result.flags).length} из ${countries.length}`);
  console.log(`контуры: ${Object.keys(result.shapes).length} из ${countries.length}`);
  levelNames.forEach((level) => {
    const inLevel = countries.filter((country) => country.level === level);
    const withFlag = inLevel.filter((country) => result.flags[country.code]).length;
    const withShape = inLevel.filter((country) => result.shapes[country.code]).length;
    console.log(`  ${level.padEnd(10)} всего ${String(inLevel.length).padStart(3)} | флагов ${String(withFlag).padStart(3)} | контуров ${String(withShape).padStart(3)}`);
  });
  const totalBytes = Object.values(result.flags).concat(Object.values(result.shapes))
    .reduce((sum, size) => sum + size, 0);
  console.log(`общий размер картинок: ${(totalBytes / 1024 / 1024).toFixed(2)} МБ`);
  if (result.missingFlags.length > 0) {
    console.log(`без флага (${result.missingFlags.length}): ${result.missingFlags.join(', ')}`);
  }
  if (result.missingShapes.length > 0) {
    console.log(`без контура (${result.missingShapes.length}): ${result.missingShapes.join(', ')}`);
  }
}

main().catch((error) => {
  console.error('ошибка:', error);
  process.exit(1);
});
