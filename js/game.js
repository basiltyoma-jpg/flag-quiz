/**
 * Логика игры: пулы стран по режиму и уровню, генерация раундов и вариантов
 * ответа. Файл не зависит от DOM, поэтому его же проверяет tools/selftest.js.
 *
 * Требует глобальные COUNTRIES (js/data.js) и AVAILABLE (js/assets.js).
 */
'use strict';

/**
 * Режимы игры.
 *
 * kind: 'options' — ответ выбирается из четырёх кнопок;
 *       'typing'  — название страны нужно написать самому.
 */
const MODES = [
  {
    id: 'flags',
    title: 'Флаги',
    icon: '🏳️',
    description: 'Узнай страну по государственному флагу',
    question: 'Чей это флаг?',
    kind: 'options',
    asset: (code) => `assets/flags/${code}.svg`,
    pool: () => AVAILABLE.flags,
    poolLabel: 'флагов'
  },
  {
    id: 'shapes',
    title: 'Территории',
    icon: '🗺️',
    description: 'Узнай страну по форме её территории',
    question: 'Чья это территория?',
    kind: 'options',
    asset: (code) => `assets/shapes/${code}.svg`,
    pool: () => AVAILABLE.shapes,
    poolLabel: 'контуров'
  },
  {
    id: 'typing',
    title: 'Название по флагу',
    icon: '⌨️',
    description: 'Напишите название страны по флагу',
    question: 'Напишите название страны',
    kind: 'typing',
    asset: (code) => `assets/flags/${code}.svg`,
    pool: () => AVAILABLE.flags,
    poolLabel: 'флагов'
  }
];

/** Уровни сложности. */
const LEVELS = [
  {
    id: 'easy',
    title: 'Лёгкий',
    description: 'Флаги, которые знают все',
    accent: '#34d399'
  },
  {
    id: 'medium',
    title: 'Средний',
    description: 'Популярные страны мира',
    accent: '#60a5fa'
  },
  {
    id: 'hard',
    title: 'Сложный',
    description: 'Малоизвестные страны',
    accent: '#fbbf24'
  },
  {
    id: 'impossible',
    title: 'Невозможный',
    description: 'Микрогосударства, острова, заморские территории',
    accent: '#f87171'
  }
];

/** Сколько вариантов ответа показывать в каждом вопросе. */
const OPTION_COUNT = 4;
const MIN_ROUNDS = 1;
const MAX_ROUNDS = 50;

/** Перемешивает массив (алгоритм Фишера — Йетса), не меняя исходный. */
function shuffle(items, random = Math.random) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = result[i];
    result[i] = result[j];
    result[j] = swap;
  }
  return result;
}

/** Приводит количество раундов к диапазону 1…50. */
function clampRounds(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) {
    return MIN_ROUNDS;
  }
  return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, number));
}

function modeById(modeId) {
  return MODES.find((mode) => mode.id === modeId) || MODES[0];
}

function levelById(levelId) {
  return LEVELS.find((level) => level.id === levelId) || LEVELS[0];
}

/** Все страны, для которых есть картинка в выбранном режиме. */
function availableCountries(modeId) {
  const assets = modeById(modeId).pool();
  return COUNTRIES.filter((country) => assets[country.code]);
}

/** Страны одного режима и уровня — из них берутся и вопросы, и «обманки». */
function poolFor(modeId, levelId) {
  return availableCountries(modeId).filter((country) => country.level === levelId);
}

/**
 * Выбирает страны-вопросы без повторов внутри прохода. Если раундов больше,
 * чем стран в уровне, список проходится заново в новом порядке — при этом
 * два подряд одинаковых вопроса не выпадают.
 */
function pickQuestions(pool, rounds, random) {
  const questions = [];
  let cycle = [];
  while (questions.length < rounds) {
    if (cycle.length === 0) {
      cycle = shuffle(pool, random);
      const previous = questions[questions.length - 1];
      if (previous && cycle.length > 1 && cycle[0].code === previous.code) {
        const first = cycle[0];
        cycle[0] = cycle[1];
        cycle[1] = first;
      }
    }
    questions.push(cycle.shift());
  }
  return questions;
}

/**
 * Собирает четыре варианта ответа: один верный и три «обманки» из того же
 * уровня (если стран в уровне мало — добирает из остальных).
 * Возвращает варианты в случайном порядке.
 */
function buildOptions(correct, pool, allPool, random) {
  const names = [correct.name];
  const takeFrom = (candidates) => {
    for (const candidate of shuffle(candidates, random)) {
      if (names.length >= OPTION_COUNT) {
        return;
      }
      if (!names.includes(candidate.name)) {
        names.push(candidate.name);
      }
    }
  };

  takeFrom(pool.filter((country) => country.code !== correct.code));
  if (names.length < OPTION_COUNT) {
    takeFrom(allPool.filter((country) => country.code !== correct.code));
  }

  return shuffle(names, random).map((name) => ({
    name,
    correct: name === correct.name
  }));
}

/** Создаёт набор раундов для игры. */
function createQuiz({ modeId, levelId, rounds, random = Math.random }) {
  const mode = modeById(modeId);
  const kind = mode.kind || 'options';
  const pool = poolFor(modeId, levelId);
  if (pool.length < OPTION_COUNT) {
    throw new Error(`Недостаточно данных: уровень "${levelId}" в режиме "${modeId}"`);
  }

  const questions = pickQuestions(pool, clampRounds(rounds), random).map((country) => ({
    code: country.code,
    name: country.name,
    image: mode.asset(country.code),
    letters: lettersIn(country.name),
    options:
      kind === 'typing' ? [] : buildOptions(country, pool, availableCountries(modeId), random)
  }));

  return {
    modeId: mode.id,
    kind,
    levelId: levelById(levelId).id,
    rounds: questions.length,
    questions
  };
}

/** Процент правильных ответов. */
function percent(correct, rounds) {
  return rounds > 0 ? Math.round((correct / rounds) * 100) : 0;
}

/** Ключ для личного рекорда в localStorage. */
function bestKey(modeId, levelId) {
  return `flagquiz:best:${modeId}:${levelId}`;
}

/** Текстовая оценка результата. */
function rateResult(value) {
  if (value === 100) {
    return 'Идеально! Ни одной ошибки 🏆';
  }
  if (value >= 90) {
    return 'Профессор географии 🌍';
  }
  if (value >= 70) {
    return 'Отличный результат 🎉';
  }
  if (value >= 50) {
    return 'Неплохо, но можно лучше 💪';
  }
  if (value >= 25) {
    return 'Есть над чем поработать 📚';
  }
  return 'Начало положено 🌱';
}

/* --------------------------------------------- проверка набранного ответа */

/** Склонение слова «раунд»: 1 раунд, 3 раунда, 7 раундов. */
function roundsWord(count) {
  const absolute = Math.abs(Number(count) || 0);
  if (absolute % 100 >= 11 && absolute % 100 <= 14) {
    return 'раундов';
  }
  switch (absolute % 10) {
    case 1:
      return 'раунд';
    case 2:
    case 3:
    case 4:
      return 'раунда';
    default:
      return 'раундов';
  }
}

/** Сколько букв в названии: без пробелов, дефисов и знаков препинания. */
function lettersIn(name) {
  return String(name).replace(/[^0-9a-zA-Zа-яА-ЯёЁ]/g, '').length;
}

/**
 * Приводит ответ игрока к сравнимому виду: нижний регистр, «ё» заменяется на «е»,
 * убираются пробелы, дефисы, апострофы и остальная пунктуация.
 * Благодаря этому « Кот-д’Ивуар » и «кот д ивуар» считаются одинаковыми.
 */
function normalizeAnswer(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я]/g, '');
}

/** Расстояние Левенштейна: сколько правок нужно, чтобы получить одну строку из другой. */
function editDistance(first, second) {
  const a = String(first);
  const b = String(second);
  if (a === b) {
    return 0;
  }
  let previous = [];
  let current = [];
  for (let j = 0; j <= b.length; j += 1) {
    previous[j] = j;
  }
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[b.length];
}

/** Все допустимые написания ответа: название страны и необязательные синонимы. */
function answerVariants(country) {
  return [country.name].concat(country.aliases || []);
}

/**
 * Проверяет ответ, набранный вручную в режиме «Название по флагу».
 *
 * verdict:
 *   correct — точное совпадение с названием или синонимом;
 *   close   — опечатка в один символ (засчитывается, но игрок об этом узнаёт);
 *   wrong   — ответ не принят.
 */
function compareTypedAnswer(input, country) {
  const guess = normalizeAnswer(input);
  const answer = country.name;
  if (!guess) {
    return { verdict: 'wrong', correct: false, answer };
  }
  const variants = answerVariants(country).map(normalizeAnswer);
  if (variants.includes(guess)) {
    return { verdict: 'correct', correct: true, answer };
  }
  const close = variants.some(
    (variant) =>
      variant.length >= 5 &&
      Math.abs(variant.length - guess.length) <= 1 &&
      editDistance(variant, guess) === 1
  );
  return close ? { verdict: 'close', correct: true, answer } : { verdict: 'wrong', correct: false, answer };
}
