/**
 * Экраны дуэли: настройка пати, лобби, панель соперника и итог матча.
 *
 * Модуль связывает три части:
 *   js/duel.js — правила и ход матча;
 *   js/net.js  — транспорт (локальный канал, WebRTC или тестовая шина);
 *   js/app.js  — экран игры (startQuiz и показ результата).
 */
'use strict';

const DuelUI = (() => {
  const NAME_KEY = 'flagquiz:name';
  const KIND_KEY = 'flagquiz:transport';
  const KNOCK_RETRY_MS = 1200;
  const KNOCK_RETRY_LIMIT = 25;

  const refs = {};
  let party = null;
  let kind = 'local';
  let lastStatus = null;
  let knockTimerId = null;

  /* ------------------------------------------------------------- утилиты */

  function cacheRefs() {
    const ids = {
      name: 'duel-name',
      transports: 'transports',
      create: 'btn-party-create',
      code: 'duel-code',
      join: 'btn-party-join',
      hint: 'party-hint',
      partyCode: 'party-code',
      settings: 'party-settings',
      copyCode: 'btn-copy-code',
      link: 'party-link',
      p2p: 'party-p2p',
      step: 'party-step',
      signal: 'party-signal',
      reply: 'party-reply',
      accept: 'btn-party-accept',
      copySignal: 'btn-copy-signal',
      players: 'party-players',
      status: 'party-status',
      start: 'btn-party-start',
      leave: 'btn-party-leave',
      bar: 'duelbar',
      me: 'duel-me',
      rival: 'duel-rival',
      note: 'duel-note',
      result: 'duel-result',
      resultTitle: 'duel-title',
      resultScore: 'duel-score'
    };
    Object.keys(ids).forEach((key) => {
      refs[key] = document.getElementById(ids[key]);
    });
  }

  function setText(name, text) {
    if (refs[name]) {
      refs[name].textContent = text;
    }
  }

  function setHint(text) {
    if (refs.hint) {
      refs.hint.textContent = text;
    }
  }

  function setStatus(state, text) {
    lastStatus = { state, text };
    setText('status', text || '');
  }

  function stored(key) {
    try {
      return window.localStorage.getItem(key) || '';
    } catch (error) {
      return '';
    }
  }

  function store(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      /* приватный режим браузера: просто не запоминаем настройку */
    }
  }

  function currentName() {
    const typed = refs.name ? refs.name.value.trim() : '';
    if (typed) {
      store(NAME_KEY, typed);
    }
    return sanitizeName(typed || stored(NAME_KEY));
  }

  function showScreenSafe(name) {
    if (typeof showScreen === 'function') {
      showScreen(name);
    }
  }

  function goHome() {
    showScreenSafe('home');
    if (typeof renderPoolHint === 'function') {
      renderPoolHint();
    }
    if (typeof renderStart === 'function') {
      renderStart();
    }
  }

  function hideP2P() {
    if (refs.p2p) {
      refs.p2p.hidden = true;
    }
  }

  async function copyText(text) {
    if (!text) {
      setStatus('error', 'Нечего копировать');
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        setStatus('open', 'Скопировано в буфер обмена');
        return;
      }
    } catch (error) {
      /* браузер запретил доступ к буферу — попробуем по-старинке */
    }
    try {
      const helper = document.createElement('textarea');
      helper.value = text;
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      document.body.removeChild(helper);
      setStatus('open', 'Скопировано в буфер обмена');
    } catch (error) {
      setStatus('error', 'Скопируйте текст вручную');
    }
  }

  /* --------------------------------------------- выбор способа соединения */

  function renderTransports() {
    if (!refs.transports) {
      return;
    }
    const available = availableTransportKinds();
    const preferred = stored(KIND_KEY);
    if (!available.some((item) => item.id === kind)) {
      kind = available.length ? available[0].id : 'local';
    }
    if (preferred && available.some((item) => item.id === preferred)) {
      kind = preferred;
    }

    refs.transports.innerHTML = '';
    available.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = item.id === kind ? 'transport is-active' : 'transport';
      button.dataset.transport = item.id;
      button.setAttribute('aria-pressed', String(item.id === kind));

      const title = document.createElement('span');
      title.className = 'transport__title';
      title.textContent = item.title;
      const description = document.createElement('span');
      description.className = 'transport__description';
      description.textContent = item.description;

      button.appendChild(title);
      button.appendChild(description);
      refs.transports.appendChild(button);
    });
  }

  /* ------------------------------------------------------- создание пати */

  function sendMessages(list) {
    if (!party || !party.transport) {
      return;
    }
    (list || []).forEach((message) => {
      party.transport.send(message);
    });
  }

  function emptyParty(role, code, name, transport, session) {
    return {
      role,
      kind,
      code,
      name,
      transport,
      session,
      deck: null,
      knocks: 0
    };
  }

  /** Хост: настраивает пати и ждёт соперника. */
  function createParty() {
    if (!transportSupported(kind)) {
      setHint('Этот способ игры недоступен в браузере — выберите другой.');
      return;
    }
    leaveParty({ quiet: true });
    const name = currentName();
    const code = createPartyCode();
    const transport = createTransport(kind, { code });
    const session = createDuelSession({
      role: 'host',
      name,
      code,
      settings: { modeId: state.modeId, levelId: state.levelId, rounds: state.rounds }
    });

    party = emptyParty('host', code, name, transport, session);
    bindTransport();
    prepareExchange();
    renderLobby();
    showScreenSafe('lobby');
    setStatus('connecting', `Пати ${code} создана — ждём соперника`);

    if (transport.needsExchange) {
      refs.p2p.hidden = false;
      setText(
        'step',
        'Шаг 1: отправьте сопернику код-приглашение. Шаг 2: вставьте код-ответ в поле ниже и нажмите «Принять код».'
      );
      transport
        .createInvite()
        .then((invite) => {
          refs.signal.value = invite;
        })
        .catch((error) => setStatus('error', error.message || 'Не удалось создать код-приглашение'));
    }
  }

  /** Гость: подключается к пати по коду. */
  function joinParty() {
    const code = normalizePartyCode(refs.code ? refs.code.value : '');
    if (!code) {
      setHint('Код пати — 4 символа: латинские буквы и цифры без 0/O и 1/I.');
      return;
    }
    if (!transportSupported(kind)) {
      setHint('Этот способ игры недоступен в браузере — выберите другой.');
      return;
    }
    leaveParty({ quiet: true });
    const name = currentName();
    const transport = createTransport(kind, { code });
    const session = createDuelSession({ role: 'guest', name, code });

    party = emptyParty('guest', code, name, transport, session);
    bindTransport();
    prepareExchange();
    renderLobby();
    showScreenSafe('lobby');
    setStatus('connecting', `Подключаемся к пати ${code}…`);

    if (transport.needsExchange) {
      refs.p2p.hidden = false;
      setText('step', 'Вставьте код-приглашение от хоста в поле ниже и нажмите «Принять код».');
    }
    /* хост мог ещё не открыть канал, поэтому стучимся с повторами */
    window.setTimeout(knockOnDoor, 300);
  }

  /** Готовит поля обмена кодами к новому подключению. */
  function prepareExchange() {
    hideP2P();
    if (refs.signal) {
      refs.signal.value = '';
    }
    if (refs.reply) {
      refs.reply.value = '';
    }
  }

  /** Гость: сообщает хосту «я в пати», повторяя попытки до ответа. */
  function knockOnDoor() {
    stopKnocking();
    if (!party || party.role !== 'guest' || party.session.state.connected) {
      return;
    }
    if (party.knocks >= KNOCK_RETRY_LIMIT) {
      setStatus('error', `Пати ${party.code} не отвечает: проверьте код`);
      return;
    }
    party.knocks += 1;
    sendMessages(party.session.join());
    knockTimerId = window.setInterval(knockOnDoor, KNOCK_RETRY_MS);
  }

  function stopKnocking() {
    if (knockTimerId) {
      window.clearInterval(knockTimerId);
      knockTimerId = null;
    }
  }

  /** Принимает код соперника: приглашение (гость) или ответ (хост). */
  async function acceptExchange() {
    if (!party) {
      setHint('Сначала создайте пати или подключитесь по коду.');
      return;
    }
    const code = refs.reply ? refs.reply.value.trim() : '';
    if (!code) {
      setStatus('error', 'Вставьте код соперника в поле ввода');
      return;
    }
    try {
      if (party.role === 'host') {
        await party.transport.acceptReply(code);
        setStatus('connecting', 'Соединяемся с соперником…');
      } else {
        setStatus('gathering', 'Готовим код-ответ…');
        const reply = await party.transport.acceptInvite(code);
        refs.signal.value = reply;
        setText('step', 'Отправьте этот код-ответ хосту и дождитесь соединения.');
        setStatus('connecting', 'Ждём, пока хост примет код-ответ…');
      }
    } catch (error) {
      setStatus('error', error.message || 'Не удалось принять код');
    }
  }

  /* ---------------------------------------------------------- ход дуэли */

  /** Подписывает транспорт на сообщения и статусы соперника. */
  function bindTransport() {
    const { transport, session } = party;

    transport.onStatus((status) => {
      if (!party) {
        return;
      }
      setStatus(status.state, status.text);
      if (status.state === 'open' && party.role === 'guest') {
        knockOnDoor();
      }
    });

    transport.onMessage((message) => {
      if (!party) {
        return;
      }
      sendMessages(session.handle(message));
      afterMessage();
    });
  }

  /** Обновляет всё, что зависит от нового сообщения соперника. */
  function afterMessage() {
    if (!party) {
      return;
    }
    renderLobby();
    maybeStartPlaying();
    refreshBar();
    if (refs.result && state.screen === 'result') {
      renderDuelResult();
    }
  }

  /** Показывает игру: колоду собирает хост, гость получает её сообщением. */
  function maybeStartPlaying() {
    if (!party) {
      return;
    }
    const deck = party.session.state.quiz;
    if (!deck || deck === party.deck) {
      return;
    }
    party.deck = deck;
    stopKnocking();
    showScreenSafe('game');
    if (typeof startQuiz === 'function') {
      startQuiz(deck);
    }
  }

  /** Хост: начинает дуэль собственной колодой раундов. */
  function startDuel() {
    if (!party || party.role !== 'host') {
      return;
    }
    if (!party.session.state.connected) {
      setStatus('error', 'Дождитесь соперника: он ещё не подключился');
      return;
    }
    sendMessages(party.session.start());
    maybeStartPlaying();
  }

  /** Перерисовывает состав пати и кнопки лобби. */
  function renderLobby() {
    if (!party || !refs.players) {
      return;
    }
    const { session } = party;
    setText('partyCode', party.code);
    setText('settings', describeDuelSettings(session.state.settings));
    setText(
      'link',
      party.kind === 'local'
        ? `Откройте игру во втором окне, введите код ${party.code} и нажмите «Подключиться».`
        : 'Обменяйтесь кодами в мессенджере: соединение установится напрямую, без сервера.'
    );

    const rival = session.rival();
    const rows = [
      { name: session.me().name, role: 'вы', ready: true },
      { name: rival ? rival.name : 'ждём соперника…', role: 'соперник', ready: Boolean(rival) }
    ];
    refs.players.innerHTML = '';
    rows.forEach((row) => {
      const item = document.createElement('li');
      item.className = row.ready ? 'party__player' : 'party__player is-empty';
      const name = document.createElement('span');
      name.className = 'party__player-name';
      name.textContent = row.name;
      const role = document.createElement('span');
      role.className = 'party__player-role';
      role.textContent = row.role;
      item.appendChild(name);
      item.appendChild(role);
      refs.players.appendChild(item);
    });

    const isHost = party.role === 'host';
    refs.start.hidden = !isHost;
    refs.start.disabled = !isHost || !session.state.connected;

    if (refs.status) {
      refs.status.className = session.error ? 'party__status is-error' : 'party__status';
      refs.status.textContent =
        session.error || session.note || (lastStatus ? lastStatus.text : '');
    }
  }

  /** Панель над вопросом: счёт соперника и его прогресс. */
  function refreshBar() {
    if (!refs.bar) {
      return;
    }
    if (!party) {
      refs.bar.hidden = true;
      if (refs.note) {
        refs.note.hidden = true;
      }
      return;
    }
    const { session } = party;
    refs.bar.hidden = false;
    setText('me', `Вы: ${session.me().correct}`);
    const rival = session.rival();
    setText('rival', rival ? `${rival.name}: ${rival.correct}` : 'Соперник: —');

    const total = session.state.rounds;
    const answered = session.answeredCount(session.rivalId());
    let note = '';
    if (!session.state.connected) {
      note = 'Соперник вышел из пати';
    } else if (total && answered < total) {
      note = `Соперник ответил на ${answered} из ${total}`;
    } else if (total) {
      note = 'Соперник отыграл все раунды';
    }
    if (refs.note) {
      refs.note.hidden = !note;
      refs.note.textContent = note;
    }
  }

  /** Блок с итогом матча на экране результатов. */
  function renderDuelResult() {
    if (!refs.result) {
      return;
    }
    if (!party) {
      refs.result.hidden = true;
      return;
    }
    const summary = party.session.summary();
    const titles = { win: 'Победа! 🏆', lose: 'Поражение', draw: 'Ничья' };
    refs.result.hidden = false;
    setText('resultTitle', summary.finished ? titles[summary.outcome] : 'Ждём соперника…');

    const me = summary.me;
    const rival = summary.rival;
    if (summary.finished && rival) {
      const byTime = summary.outcome !== 'draw' && me.correct === rival.correct;
      setText(
        'resultScore',
        `Вы ${me.correct} : ${rival.correct} ${rival.name}` +
          `${byTime ? ' · спор решило время ответов' : ''}`
      );
    } else {
      setText('resultScore', summary.text);
    }
  }

  /** «Ещё раз»: хост сразу раздаёт новую колоду, гость просит об этом хоста. */
  function rematch() {
    if (!party) {
      return false;
    }
    sendMessages(party.session.rematch());
    if (party.role === 'host') {
      maybeStartPlaying();
      refreshBar();
      renderDuelResult();
    } else {
      setText('resultTitle', 'Ждём хоста…');
      setStatus('connecting', 'Запрос отправлен хосту — ждём новую партию');
    }
    return true;
  }

  /** Отправляет дуэли результат раунда вместе со временем ответа. */
  function reportAnswer(result) {
    if (!party || party.session.state.phase !== 'playing') {
      return;
    }
    sendMessages(party.session.submit(result));
    refreshBar();
  }

  /** Выходит из пати: сообщает сопернику и закрывает канал. */
  function leaveParty(options) {
    const quiet = Boolean(options && options.quiet);
    stopKnocking();
    if (!party) {
      return;
    }
    if (!quiet) {
      sendMessages(party.session.leave());
    }
    if (party.transport) {
      party.transport.close();
    }
    party = null;
    lastStatus = null;
    prepareExchange();
    refreshBar();
    if (refs.result) {
      refs.result.hidden = true;
    }
  }

  /** Вызывается кнопкой «В меню»: если идёт дуэль — аккуратно выходим. */
  function leaveIfActive() {
    if (!party) {
      return;
    }
    leaveParty();
    goHome();
    setStatus('closed', 'Дуэль завершена — можно создать новую пати.');
  }

  /* -------------------------------------------------------------- запуск */

  /** Читает подсказки из адресной строки: ?net=p2p&party=ABCD&invite=… */
  function readUrlParams() {
    let params = null;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (error) {
      return;
    }
    const requested = params.get('net');
    if (requested && transportSupported(requested)) {
      kind = requested;
      renderTransports();
    }
    const code = normalizePartyCode(params.get('party'));
    if (code && refs.code) {
      refs.code.value = code;
    }
    const invite = params.get('invite');
    if (invite && refs.reply) {
      refs.reply.value = invite;
    }
  }

  /** Точка входа: вызывается из js/app.js после отрисовки настроек. */
  function init() {
    cacheRefs();
    if (refs.name) {
      refs.name.value = stored(NAME_KEY);
      refs.name.addEventListener('change', () => {
        const typed = refs.name.value.trim();
        if (typed) {
          store(NAME_KEY, typed);
        }
      });
    }

    renderTransports();
    readUrlParams();

    if (refs.transports) {
      refs.transports.addEventListener('click', (event) => {
        const button = event.target.closest('.transport');
        if (!button) {
          return;
        }
        kind = button.dataset.transport;
        store(KIND_KEY, kind);
        renderTransports();
      });
    }
    if (refs.create) {
      refs.create.addEventListener('click', createParty);
    }
    if (refs.join) {
      refs.join.addEventListener('click', joinParty);
    }
    if (refs.code) {
      refs.code.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          joinParty();
        }
      });
    }
    if (refs.accept) {
      refs.accept.addEventListener('click', acceptExchange);
    }
    if (refs.copyCode) {
      refs.copyCode.addEventListener('click', () => copyText(party ? party.code : ''));
    }
    if (refs.copySignal) {
      refs.copySignal.addEventListener('click', () => {
        copyText(refs.signal ? refs.signal.value : '');
      });
    }
    if (refs.start) {
      refs.start.addEventListener('click', startDuel);
    }
    if (refs.leave) {
      refs.leave.addEventListener('click', () => {
        leaveParty();
        goHome();
      });
    }
    refreshBar();
  }

  return {
    init,
    refreshBar,
    reportAnswer,
    renderDuelResult,
    rematch,
    leaveIfActive
  };
})();



