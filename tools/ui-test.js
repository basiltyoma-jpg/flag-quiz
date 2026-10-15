/**
 * Функциональный тест интерфейса: поднимает настоящий HTTP-сервер с папкой
 * проекта, открывает index.html в jsdom, кликает по элементам и проверяет
 * игровой цикл в обоих режимах (настройки, раунды, варианты ответа, рекорд).
 *
 * Нужен пакет jsdom (используется только тестом):
 *     npm install jsdom
 *
 * Запуск:
 *     node tools/ui-test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { JSDOM, VirtualConsole } = require('jsdom');

const SITE = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};

let checks = 0;
let failures = 0;

function check(condition, label) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.log(`  [ОШИБКА] ${label}`);
  }
}

const requests = [];

const server = http.createServer((request, response) => {
  const rel = decodeURIComponent(request.url.split('?')[0]);
  const file = path.join(SITE, rel === '/' ? 'index.html' : rel);
  const inside = file.startsWith(SITE);
  if (!inside || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    requests.push({ url: request.url, status: 404 });
    response.writeHead(404);
    response.end('not found');
    return;
  }
  requests.push({ url: request.url, status: 200 });
  response.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream'
  });
  fs.createReadStream(file).pipe(response);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const url = `${origin}/index.html`;

  const jsdomErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => {
    /* jsdom умеет сообщать о неподдерживаемых методах (scrollTo) — это не ошибка страницы */
    if (!error.message.startsWith('Not implemented')) {
      jsdomErrors.push(error.message);
    }
  });

  const dom = await JSDOM.fromURL(url, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole
  });
  const { window } = dom;
  const doc = window.document;
  await new Promise((resolve) => {
    if (doc.readyState === 'complete') {
      resolve();
    } else {
      window.addEventListener('load', resolve);
    }
  });
  await sleep(250);

  const $ = (selector) => doc.querySelector(selector);
  const $$ = (selector) => Array.from(doc.querySelectorAll(selector));
  const text = (selector) => ($(selector) ? $(selector).textContent.trim() : '');
  const click = (element) => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const press = (key) =>
    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));

  /* ------------------------------------------------------------ настройки */

  console.log('== загрузка страницы');
  check(jsdomErrors.length === 0, `ошибки загрузки: ${jsdomErrors.join(' | ')}`);
  check($$('#modes .mode').length === 3, 'на главной должно быть 3 режима');
  check($$('#levels .level').length === 4, 'на главной должно быть 4 уровня');
  check($('#screen-home').hidden === false, 'главный экран должен быть виден');
  check(text('#rounds-value') === '10', 'стартовое число раундов — 10');
  check($('#btn-home').hidden === true, 'кнопка «В меню» скрыта на главной');

  console.log('== переключение режима');
  click($$('#modes .mode')[1]);
  check($$('#modes .mode')[1].classList.contains('is-active'), 'активен режим «Территории»');
  check(text('#pool-hint').includes('контуров'), `подсказка про контуры: ${text('#pool-hint')}`);
  check($$('#levels .level')[0].textContent.includes('36'), 'в лёгком уровне 36 контуров');

  console.log('== ползунок раундов 1…50');
  const slider = $('#rounds');
  check(slider.getAttribute('min') === '1', 'минимум ползунка — 1');
  check(slider.getAttribute('max') === '50', 'максимум ползунка — 50');
  slider.value = '50';
  slider.dispatchEvent(new window.Event('input', { bubbles: true }));
  check(text('#rounds-value') === '50', 'ползунок показывает 50');
  check(text('#btn-start').includes('50 раундов'), `кнопка запуска: ${text('#btn-start')}`);
  check(text('#pool-hint').includes('повторятся'), 'предупреждение о повторах при 50 раундах');
  click($$('.rounds__quick button')[0]);
  check(text('#rounds-value') === '5', 'быстрая кнопка ставит 5 раундов');

  /* ----------------------------------------------------------- игра: флаги */

  console.log('== игра: флаги / лёгкий / 5 раундов');
  click($$('#modes .mode')[0]);
  check(text('#pool-hint').includes('флагов'), `подсказка про флаги: ${text('#pool-hint')}`);
  const flagRounds = 5;
  click($('#btn-start'));
  await sleep(80);

  check($('#screen-game').hidden === false, 'экран игры виден');
  check($('#screen-home').hidden === true, 'экран настроек скрыт');
  check(text('#progress-text') === 'Вопрос 1 / 5', `прогресс: ${text('#progress-text')}`);
  check(text('#question-text') === 'Чей это флаг?', `вопрос: ${text('#question-text')}`);
  check($$('#options .option').length === 4, 'четыре варианта ответа');

  let expectedCorrect = 0;
  const answeredImages = [];

  for (let round = 0; round < flagRounds; round += 1) {
    const options = $$('#options .option');
    const names = options.map((option) => option.querySelector('.option__name').textContent.trim());
    check(options.length === 4, `раунд ${round + 1}: 4 варианта ответа`);
    check(new Set(names).size === 4, `раунд ${round + 1}: названия не повторяются`);
    check(names.every((name) => name.length > 2), `раунд ${round + 1}: названия заполнены`);

    const image = $('#picture-img').getAttribute('src');
    answeredImages.push(image);
    check(
      /^assets\/flags\/[a-z]{2}\.svg$/.test(image),
      `раунд ${round + 1}: ссылка на флаг — ${image}`
    );

    const clickedOption = round === 0 ? options[0] : options[round % 4];
    if (round === 0) {
      press('1');
    } else {
      click(clickedOption);
    }

    const correctOption = $$('#options .option').find((option) =>
      option.classList.contains('is-correct')
    );
    const wasCorrect = correctOption === clickedOption;
    if (wasCorrect) {
      expectedCorrect += 1;
      check(text('#feedback-text') === 'Верно!', `раунд ${round + 1}: «Верно!»`);
    } else {
      const correctName = correctOption.querySelector('.option__name').textContent.trim();
      check(
        text('#feedback-text') === `Неверно. Правильный ответ: ${correctName}`,
        `раунд ${round + 1}: подсказка с верным ответом (${text('#feedback-text')})`
      );
    }

    check(Boolean(correctOption), `раунд ${round + 1}: подсвечен правильный вариант`);
    check(
      $$('#options .option').filter(
        (option) => option.classList.contains('is-correct') || option.classList.contains('is-wrong')
      ).length <= 2,
      `раунд ${round + 1}: подсветок не больше двух`
    );
    check($('#feedback').hidden === false, `раунд ${round + 1}: показан итог ответа`);
    check($('#btn-next').hidden === false, `раунд ${round + 1}: доступна кнопка «Дальше»`);
    check(
      text('#score-text') === `Счёт: ${expectedCorrect}`,
      `раунд ${round + 1}: счёт — ${text('#score-text')}, ждём ${expectedCorrect}`
    );

    const scoreAfterAnswer = text('#score-text');
    click(options[(round + 2) % 4]);
    check(
      text('#score-text') === scoreAfterAnswer,
      `раунд ${round + 1}: повторный клик не меняет счёт`
    );

    press(round % 2 === 0 ? 'Enter' : ' ');
    await sleep(60);
  }

  /* -------------------------------------------------------------- результат */

  console.log('== результат');
  check($('#screen-result').hidden === false, 'показан экран результата');
  check(
    text('#result-score') === String(expectedCorrect),
    `счёт: ${text('#result-score')} (ждём ${expectedCorrect})`
  );
  check(text('#result-total') === '/ 5', `всего раундов: ${text('#result-total')}`);
  const expectedPercent = Math.round((expectedCorrect / flagRounds) * 100);
  check(
    text('#result-percent').startsWith(`${expectedPercent}%`),
    `проценты: ${text('#result-percent')}`
  );
  check(text('#result-best').includes('Лучший результат'), 'есть строка с рекордом');
  check(text('#result-title') === 'Флаги · Лёгкий', `заголовок: ${text('#result-title')}`);
  check(
    window.localStorage.getItem('flagquiz:best:flags:easy') === String(expectedCorrect),
    'рекорд сохранён в localStorage'
  );
  check(
    $('#result-bar').style.width === `${expectedPercent}%`,
    `полоса результата: ${$('#result-bar').style.width}`
  );

  console.log('== повтор игры');
  click($('#btn-again'));
  await sleep(60);
  check($('#screen-game').hidden === false, '«Ещё раз» начала новую игру');
  check(text('#progress-text') === 'Вопрос 1 / 5', 'новый набор из 5 раундов');

  /* -------------------------------------------------------- игра: территории */

  console.log('== игра: территории / невозможный / 1 раунд');
  click($('#btn-home'));
  await sleep(40);
  check($('#screen-home').hidden === false, 'кнопка «В меню» вернула настройки');

  click($$('#modes .mode')[1]);
  click($$('#levels .level')[3]);
  check(
    text('#pool-hint').includes('64'),
    `в невозможном уровне 64 контура: ${text('#pool-hint')}`
  );
  const roundsSlider = $('#rounds');
  roundsSlider.value = '1';
  roundsSlider.dispatchEvent(new window.Event('input', { bubbles: true }));
  check(text('#rounds-value') === '1', 'можно выбрать 1 раунд');
  check(text('#btn-start').includes('1 раунд'), `кнопка: ${text('#btn-start')}`);
  click($('#btn-start'));
  await sleep(60);

  check(text('#progress-text') === 'Вопрос 1 / 1', `прогресс: ${text('#progress-text')}`);
  check(text('#question-text') === 'Чья это территория?', `вопрос: ${text('#question-text')}`);
  const shapeImage = $('#picture-img').getAttribute('src');
  check(/^assets\/shapes\/[a-z]{2}\.svg$/.test(shapeImage), `ссылка на контур: ${shapeImage}`);
  check(text('#picture-code') === '?', 'код страны скрыт до ответа');

  click($$('#options .option')[1]);
  check(/^[A-Z]{2}$/.test(text('#picture-code')), `после ответа код виден: ${text('#picture-code')}`);
  check($('#progress-bar').style.width === '0%', 'полоса прогресса на первом раунде пуста');
  click($('#btn-next'));
  await sleep(60);

  check($('#screen-result').hidden === false, 'один раунд завершает игру');
  check(text('#result-total') === '/ 1', 'всего один раунд');
  click($('#btn-settings'));
  await sleep(40);
  check($('#screen-home').hidden === false, '«Изменить настройки» возвращает на главную');

  /* --------------------------------------------------------------- ресурсы */

  console.log('== ресурсы');
  const notFound = requests.filter((item) => item.status === 404);
  check(
    notFound.length === 0,
    `запросов 404: ${notFound.length} (${notFound
      .slice(0, 3)
      .map((item) => item.url)
      .join(', ')})`
  );

  /* jsdom не загружает изображения, поэтому картинки запрашиваем напрямую */
  for (const image of answeredImages.concat([shapeImage])) {
    const response = await fetch(`${origin}/${image}`);
    check(response.ok, `картинка ${image}: HTTP ${response.status}`);
    const body = await response.text();
    check(body.includes('<svg'), `картинка ${image} содержит SVG-разметку`);
    check(
      fs.existsSync(path.join(SITE, image)),
      `файл ${image} есть на диске`
    );
  }
  check(
    answeredImages.every((image) => image.startsWith('assets/flags/')),
    'вопросы режима флагов ссылаются на флаги'
  );
  check(shapeImage.startsWith('assets/shapes/'), 'вопрос режима территорий ссылается на контур');

  const scripts = requests.filter((item) => item.url.endsWith('.js'));
  check(scripts.length === 8, `загружено 8 скриптов, а не ${scripts.length}`);
  check(requests.some((item) => item.url.endsWith('/css/styles.css')), 'стили подключены');

  /* ---------- публикация в подпапке: так работает GitHub Pages (/flag-quiz/) */

  console.log('== деплой в подпапку (как на GitHub Pages)');
  const parent = path.dirname(SITE);
  const prefix = path.basename(SITE);
  const pageServer = http.createServer((request, response) => {
    const rel = decodeURIComponent(request.url.split('?')[0]);
    const file = path.join(parent, rel);
    if (
      !file.startsWith(parent) ||
      !fs.existsSync(file) ||
      fs.statSync(file).isDirectory()
    ) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream'
    });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => pageServer.listen(0, '127.0.0.1', resolve));
  const pageOrigin = `http://127.0.0.1:${pageServer.address().port}`;

  const pageResponse = await fetch(`${pageOrigin}/${prefix}/index.html`);
  check(pageResponse.ok, `страница открывается в подпапке: HTTP ${pageResponse.status}`);
  const pageHtml = await pageResponse.text();
  check(pageHtml.includes('<title>'), 'из подпапки пришёл настоящий index.html');

  const refs = Array.from(pageHtml.matchAll(/(?:src|href)="([^"]+)"/g)).map((match) => match[1]);
  check(refs.length >= 5, `в index.html ссылок: ${refs.length}`);
  for (const ref of refs) {
    check(!ref.startsWith('/') && !ref.startsWith('http'), `ссылка «${ref}» относительная`);
    const response = await fetch(`${pageOrigin}/${prefix}/${ref}`);
    check(response.ok, `в подпапке доступен ${ref}: HTTP ${response.status}`);
  }

  for (const rel of ['assets/flags/ru.svg', 'assets/shapes/ru.svg', 'js/data.js']) {
    const response = await fetch(`${pageOrigin}/${prefix}/${rel}`);
    check(response.ok, `в подпапке доступен ${rel}: HTTP ${response.status}`);
  }
  pageServer.close();

  console.log(`\nпроверок: ${checks}, ошибок: ${failures}`);
  window.close();
  server.close();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('тест упал:', error);
  server.close();
  process.exit(1);
});

