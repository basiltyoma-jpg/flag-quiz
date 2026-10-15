/**
 * Интерфейс игры: экраны настроек, вопросов и результатов.
 * Вся логика (раунды, варианты ответа) живёт в js/game.js.
 */
'use strict';

const SCREENS = ['home', 'game', 'result', 'lobby'];

const state = {
  modeId: MODES[0].id,
  levelId: LEVELS[0].id,
  rounds: 10,
  screen: 'home',
  quiz: null,
  index: 0,
  correct: 0,
  answered: false,
  timerId: null,
  /** Когда показан текущий раунд: в дуэли по этому времени считается скорость ответа. */
  questionAt: 0
};

const dom = {
  screens: {
    home: document.getElementById('screen-home'),
    game: document.getElementById('screen-game'),
    result: document.getElementById('screen-result'),
    lobby: document.getElementById('screen-lobby')
  },
  modes: document.getElementById('modes'),
  levels: document.getElementById('levels'),
  rounds: document.getElementById('rounds'),
  roundsValue: document.getElementById('rounds-value'),
  poolHint: document.getElementById('pool-hint'),
  start: document.getElementById('btn-start'),
  home: document.getElementById('btn-home'),
  progressText: document.getElementById('progress-text'),
  scoreText: document.getElementById('score-text'),
  progressBar: document.getElementById('progress-bar'),
  questionText: document.getElementById('question-text'),
  picture: document.getElementById('picture'),
  pictureImg: document.getElementById('picture-img'),
  pictureCode: document.getElementById('picture-code'),
  options: document.getElementById('options'),
  feedback: document.getElementById('feedback'),
  feedbackText: document.getElementById('feedback-text'),
  next: document.getElementById('btn-next'),
  resultTitle: document.getElementById('result-title'),
  resultScore: document.getElementById('result-score'),
  resultTotal: document.getElementById('result-total'),
  resultBar: document.getElementById('result-bar'),
  resultPercent: document.getElementById('result-percent'),
  resultBest: document.getElementById('result-best'),
  again: document.getElementById('btn-again'),
  settings: document.getElementById('btn-settings'),
  answerForm: document.getElementById('answer-form'),
  answerInput: document.getElementById('answer-input'),
  answerButton: document.getElementById('btn-answer'),
  duelBar: document.getElementById('duelbar'),
  duelNote: document.getElementById('duel-note'),
  duelResult: document.getElementById('duel-result')
};

/* ------------------------------------------------------------------ экраны */

/** Показывает нужный экран и обновляет кнопку «В меню». */
function showScreen(name) {
  state.screen = name;
  SCREENS.forEach((screen) => {
    dom.screens[screen].hidden = screen !== name;
  });
  dom.home.hidden = name === 'home';
  try {
    window.scrollTo(0, 0);
  } catch (error) {
    /* некоторые встроенные браузеры не поддерживают прокрутку окна */
  }
}

/* --------------------------------------------------- настройки на главной */

/** Перерисовывает карточки режимов. */
function renderModes() {
  dom.modes.innerHTML = '';
  MODES.forEach((mode) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mode';
    button.dataset.mode = mode.id;
    button.setAttribute('aria-pressed', String(mode.id === state.modeId));
    if (mode.id === state.modeId) {
      button.classList.add('is-active');
    }
    button.innerHTML = `
      <span class="mode__icon">${mode.icon}</span>
      <span class="mode__title">${mode.title}</span>
      <span class="mode__description">${mode.description}</span>`;
    dom.modes.appendChild(button);
  });
}

/** Перерисовывает карточки уровней (с количеством стран в текущем режиме). */
function renderLevels() {
  const all = availableCountries(state.modeId);
  dom.levels.innerHTML = '';
  LEVELS.forEach((level) => {
    const count = all.filter((country) => country.level === level.id).length;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'level';
    button.dataset.level = level.id;
    button.style.setProperty('--accent', level.accent);
    button.setAttribute('aria-pressed', String(level.id === state.levelId));
    if (level.id === state.levelId) {
      button.classList.add('is-active');
    }
    button.innerHTML = `
      <span class="level__head">
        <span class="level__title">${level.title}</span>
        <span class="level__count">${count}</span>
      </span>
      <span class="level__description">${level.description}</span>`;
    dom.levels.appendChild(button);
  });
}

/** Подсказка о том, сколько стран доступно в выбранном сочетании. */
function renderPoolHint() {
  const mode = modeById(state.modeId);
  const pool = poolFor(state.modeId, state.levelId);
  const repeats =
    state.rounds <= pool.length
      ? ''
      : ` Вопросов больше, чем стран, поэтому некоторые ${mode.poolLabel} повторятся.`;
  const answers =
    (mode.kind || 'options') === 'typing'
      ? 'название страны нужно написать вручную.'
      : `в каждом вопросе ${OPTION_COUNT} варианта ответа.`;
  dom.poolHint.textContent =
    `Уровень «${levelById(state.levelId).title}»: доступно ${pool.length} ${mode.poolLabel}, ${answers}${repeats}`;
}

/** Правильная форма слова «раунд» (единственная реализация живёт в js/game.js). */
function roundWord(count) {
  return roundsWord(count);
}

/** Обновляет подпись кнопки запуска. */
function renderStart() {
  const mode = modeById(state.modeId);
  dom.start.textContent = `Играть · ${mode.title} · ${state.rounds} ${roundWord(state.rounds)}`;
}

/* ------------------------------------------------------------------- игра */

/** Начинает новую одиночную игру с текущими настройками. */
function startGame() {
  startQuiz(
    createQuiz({
      modeId: state.modeId,
      levelId: state.levelId,
      rounds: state.rounds
    })
  );
}

/**
 * Запускает готовую колоду раундов. Её собирает одиночная игра
 * или хост дуэли (js/duel-ui.js присылает колоду обоим игрокам).
 */
function startQuiz(quiz) {
  state.quiz = quiz;
  state.index = 0;
  state.correct = 0;
  state.answered = false;
  showScreen('game');
  renderQuestion();
}

/** Рисует текущий раунд. */
function renderQuestion() {
  const question = state.quiz.questions[state.index];
  const mode = modeById(state.quiz.modeId);
  const typing = state.quiz.kind === 'typing' || !question.options.length;

  state.answered = false;
  state.questionAt = Date.now();
  dom.progressText.textContent = `Вопрос ${state.index + 1} / ${state.quiz.rounds}`;
  dom.scoreText.textContent = `Счёт: ${state.correct}`;
  dom.progressBar.style.width = `${(state.index / state.quiz.rounds) * 100}%`;
  dom.questionText.textContent = mode.question;

  dom.picture.classList.remove('is-correct', 'is-wrong');
  dom.pictureImg.src = question.image;
  dom.pictureImg.alt = typing
    ? 'Напишите название страны по флагу'
    : 'Угадайте страну по картинке';
  dom.pictureCode.textContent = '?';

  dom.options.innerHTML = '';
  dom.options.hidden = typing;
  dom.answerForm.hidden = !typing;
  dom.answerButton.disabled = false;
  dom.answerInput.disabled = false;

  if (typing) {
    dom.answerInput.value = '';
    dom.answerInput.placeholder = `Ответ: ${question.letters} букв`;
    try {
      dom.answerInput.focus();
    } catch (error) {
      /* встроенные браузеры могут не поддерживать фокус */
    }
  } else {
    question.options.forEach((option, position) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'option';
      button.dataset.name = option.name;
      button.innerHTML =
        `<span class="option__key">${position + 1}</span>` +
        `<span class="option__name">${option.name}</span>`;
      dom.options.appendChild(button);
    });
  }

  dom.feedback.hidden = true;
  dom.next.hidden = true;

  refreshDuelBar();
  preloadNextImage();
}

/** Заранее грузит картинку следующего вопроса, чтобы не было мигания. */
function preloadNextImage() {
  const next = state.quiz.questions[state.index + 1];
  if (next) {
    const image = new Image();
    image.src = next.image;
  }
}

/** Обрабатывает выбор варианта ответа. */
function answer(name, button) {
  if (state.answered) {
    return;
  }
  const question = state.quiz.questions[state.index];
  const isCorrect = name === question.name;
  settleAnswer(
    isCorrect,
    isCorrect ? 'Верно!' : `Неверно. Правильный ответ: ${question.name}`,
    { button }
  );
}

/** Проверяет ответ, набранный вручную (режим «Название по флагу»). */
function submitTypedAnswer() {
  if (state.answered || state.screen !== 'game') {
    return;
  }
  const question = state.quiz.questions[state.index];
  const value = dom.answerInput.value;
  if (!value.trim()) {
    return;
  }
  const verdict = compareTypedAnswer(value, question);
  const feedback =
    verdict.verdict === 'correct'
      ? 'Верно!'
      : verdict.verdict === 'close'
        ? `Верно, но с опечаткой: ${verdict.answer}`
        : `Неверно. Правильный ответ: ${verdict.answer}`;
  settleAnswer(verdict.correct, feedback);
}

/** Фиксирует ответ раунда: подсветка, подсказка, переход дальше и отчёт дуэли. */
function settleAnswer(isCorrect, feedbackText, options) {
  const settings = options || {};
  state.answered = true;

  const question = state.quiz.questions[state.index];
  if (isCorrect) {
    state.correct += 1;
  }

  dom.options.querySelectorAll('.option').forEach((optionButton) => {
    optionButton.classList.add('is-locked');
    if (optionButton.dataset.name === question.name) {
      optionButton.classList.add('is-correct');
    } else if (optionButton === settings.button) {
      optionButton.classList.add('is-wrong');
    }
  });
  if (settings.button) {
    settings.button.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
    settings.button.classList.add('is-locked');
  }

  dom.picture.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
  dom.pictureCode.textContent = question.code.toUpperCase();
  dom.scoreText.textContent = `Счёт: ${state.correct}`;

  dom.answerInput.disabled = true;
  dom.answerButton.disabled = true;

  dom.feedback.hidden = false;
  dom.feedbackText.className = isCorrect ? 'feedback__text is-correct' : 'feedback__text is-wrong';
  dom.feedbackText.textContent = feedbackText;
  dom.next.hidden = false;

  reportDuelAnswer(isCorrect);
  state.timerId = window.setTimeout(nextQuestion, isCorrect ? 1100 : 1900);
}

/** Переходит к следующему раунду или показывает результат. */
function nextQuestion() {
  window.clearTimeout(state.timerId);
  state.timerId = null;
  if (!state.answered) {
    return;
  }
  state.index += 1;
  if (state.index >= state.quiz.rounds) {
    showResult();
  } else {
    renderQuestion();
  }
}

/* -------------------------------------------------------------- результат */

/** Читает личный рекорд из localStorage (может быть недоступен). */
function readBest(key) {
  try {
    return Number(window.localStorage.getItem(key)) || 0;
  } catch (error) {
    return 0;
  }
}

/** Сохраняет личный рекорд. */
function writeBest(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch (error) {
    /* приватный режим браузера — рекорды просто не сохраняются */
  }
}

/** Показывает экран результатов. */
function showResult() {
  const rounds = state.quiz.rounds;
  const value = percent(state.correct, rounds);
  const mode = modeById(state.quiz.modeId);
  const level = levelById(state.quiz.levelId);
  const key = bestKey(state.quiz.modeId, state.quiz.levelId);
  const best = Math.max(readBest(key), state.correct);
  writeBest(key, best);

  dom.resultTitle.textContent = `${mode.title} · ${level.title}`;
  dom.resultScore.textContent = String(state.correct);
  dom.resultTotal.textContent = `/ ${rounds}`;
  dom.resultBar.style.width = `${value}%`;
  dom.resultPercent.textContent = `${value}% · ${rateResult(value)}`;
  dom.resultBest.textContent =
    best === state.correct
      ? `Лучший результат для этого уровня: ${best} из ${rounds} — это рекорд!`
      : `Лучший результат для этого уровня: ${best} из ${rounds}`;

  showScreen('result');
  refreshDuelResult();
}

/* --------------------------------------------- связка с дуэлью (js/duel-ui.js) */

/** Если идёт дуэль, обновляет её панель над вопросом. */
function refreshDuelBar() {
  if (typeof DuelUI !== 'undefined' && DuelUI.refreshBar) {
    DuelUI.refreshBar();
  }
}

/** Отдаёт дуэли результат раунда вместе со временем ответа. */
function reportDuelAnswer(isCorrect) {
  if (typeof DuelUI !== 'undefined' && DuelUI.reportAnswer) {
    DuelUI.reportAnswer({ correct: isCorrect, ms: Date.now() - state.questionAt });
  }
}

/** «Ещё раз»: в дуэли новую партию запускает её модуль. */
function playAgain() {
  if (typeof DuelUI !== 'undefined' && DuelUI.rematch && DuelUI.rematch()) {
    return;
  }
  startGame();
}

/** Если идёт дуэль, обновляет её блок на экране результатов. */
function refreshDuelResult() {
  if (typeof DuelUI !== 'undefined' && DuelUI.renderDuelResult) {
    DuelUI.renderDuelResult();
  }
}

/* ----------------------------------------------------- обработчики событий */

function wireEvents() {
  dom.modes.addEventListener('click', (event) => {
    const button = event.target.closest('.mode');
    if (!button) {
      return;
    }
    state.modeId = button.dataset.mode;
    renderModes();
    renderLevels();
    renderPoolHint();
    renderStart();
  });

  dom.levels.addEventListener('click', (event) => {
    const button = event.target.closest('.level');
    if (!button) {
      return;
    }
    state.levelId = button.dataset.level;
    renderLevels();
    renderPoolHint();
    renderStart();
  });

  dom.rounds.addEventListener('input', () => {
    state.rounds = clampRounds(dom.rounds.value);
    dom.roundsValue.textContent = String(state.rounds);
    renderPoolHint();
    renderStart();
  });

  document.querySelectorAll('.rounds__quick button').forEach((quickButton) => {
    quickButton.addEventListener('click', () => {
      dom.rounds.value = quickButton.dataset.rounds;
      dom.rounds.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  dom.start.addEventListener('click', startGame);
  dom.next.addEventListener('click', nextQuestion);

  dom.answerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitTypedAnswer();
  });

  dom.options.addEventListener('click', (event) => {
    const button = event.target.closest('.option');
    if (button) {
      answer(button.dataset.name, button);
    }
  });

  dom.again.addEventListener('click', playAgain);
  dom.settings.addEventListener('click', () => {
    showScreen('home');
    renderPoolHint();
    renderStart();
  });
  dom.home.addEventListener('click', () => {
    window.clearTimeout(state.timerId);
    state.timerId = null;
    if (typeof DuelUI !== 'undefined' && DuelUI.leaveIfActive) {
      DuelUI.leaveIfActive();
    }
    showScreen('home');
    renderPoolHint();
    renderStart();
  });

  document.addEventListener('keydown', (event) => {
    if (state.screen === 'game') {
      const position = ['1', '2', '3', '4'].indexOf(event.key);
      if (position >= 0 && !state.answered && !dom.options.hidden) {
        const buttons = dom.options.querySelectorAll('.option');
        if (buttons[position]) {
          answer(buttons[position].dataset.name, buttons[position]);
        }
        event.preventDefault();
        return;
      }
      if ((event.key === 'Enter' || event.key === ' ') && state.answered) {
        nextQuestion();
        event.preventDefault();
      }
      return;
    }
    if (state.screen === 'result' && event.key === 'Enter') {
      playAgain();
      event.preventDefault();
    }
  });
}

/* ------------------------------------------------------------ запуск игры */

/** Точка входа (выполняется один раз). */
let initialised = false;

function init() {
  if (initialised) {
    return;
  }
  initialised = true;
  renderModes();
  renderLevels();
  dom.rounds.value = String(state.rounds);
  dom.roundsValue.textContent = String(state.rounds);
  renderPoolHint();
  renderStart();
  wireEvents();
  showScreen('home');
  if (typeof DuelUI !== 'undefined' && DuelUI.init) {
    DuelUI.init();
  }
}

/* Скрипт может быть подключён обычным тегом, через defer или динамически,
   когда документ уже разобран, — в любом случае интерфейс инициализируется. */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}


