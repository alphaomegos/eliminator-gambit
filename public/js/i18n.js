// Tiny i18n: dictionaries, DOM binding via data-i18n*, server error translation.

const LANG_KEY = "eg.lang";
export const LANGS = ["en", "ru"];

const EN = {
  "app.title": "The Eliminator’s Gambit",
  "app.subtitle": "Eliminate carefully. One wrong tap ends the round.",
  "common.loading": "Loading…",
  "common.ok": "OK",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.back": "Back",
  "common.error": "Something went wrong",
  "common.networkError": "Network error — check your connection.",
  "lang.switch": "RU",
  "lang.switchTitle": "Переключить на русский",

  "login.name": "Game set name",
  "login.namePlaceholder": "e.g. EDUARD",
  "login.nameHint": "4–16 letters or digits. Everyone at your party uses the same name.",
  "login.pin": "PIN",
  "login.choosePin": "Choose a PIN",
  "login.setPin": "Set a PIN",
  "login.newHint": "New game set. Share the name and PIN with whoever hosts your games.",
  "login.legacyHint": "This game set has no PIN yet — the one you enter now will protect it.",
  "login.continue": "Continue",
  "login.login": "Log in",
  "login.create": "Create game set",
  "login.expiredTitle": "Logged out",
  "login.expired": "Your session has expired. Please log in again.",

  "menu.resume": "Continue match",
  "menu.newGame": "New game",
  "menu.editor": "Edit rounds",
  "menu.pin": "Change PIN",
  "menu.logout": "Log out",
  "menu.resumeHint": "{team1} {score1} : {score2} {team2} · round {round} of {total}",
  "menu.rules": "How to play",
  "menu.rule1": "Two teams take turns eliminating one option at a time.",
  "menu.rule2": "Somewhere in the list hides the target — the worst / lowest / odd one out.",
  "menu.rule3": "Each safe elimination gives your team +1. Eliminating the target costs −4 and ends the round.",
  "menu.rule4": "If only the target is left, nobody hit it and the round is a tie.",
  "menu.rule5": "Host tapped the wrong one? “↶ Undo” takes the last move back.",

  "pin.title": "Change PIN for {name}",
  "pin.current": "Current PIN",
  "pin.new": "New PIN (min 4)",
  "pin.hint": "Other devices will be logged out.",
  "pin.change": "Change",
  "pin.doneTitle": "PIN changed",
  "pin.done": "Use the new PIN next time you log in.",

  "setup.team1": "First team",
  "setup.team2": "Second team",
  "setup.team1Default": "Team 1",
  "setup.team2Default": "Team 2",
  "setup.pick": "Pick 1–10 rounds. Click order is play order.",
  "setup.clear": "Clear",
  "setup.start": "Start",
  "setup.noRounds": "No rounds yet — create some in the editor.",
  "setup.loading": "Loading rounds…",
  "setup.max": "Up to {n} rounds per match.",
  "setup.pickOne": "Pick at least one round.",
  "setup.timer": "Turn timer",
  "setup.timerOff": "Off",
  "setup.timerHint": "Just a countdown with a buzzer — the host decides what happens when time runs out.",
  "game.timeUp": "Time’s up!",
  "fx.sound": "Sound on/off",

  "kind.rated": "rated",
  "kind.manual": "manual",
  "kind.carousel": "carousel",
  "items.count": "{n} items",

  "game.next": "Next round →",
  "game.undo": "↶ Undo",
  "game.undoTitle": "Undo the last move (Ctrl+Z)",
  "game.menu": "Menu",
  "game.showAll": "Show everything",
  "game.counter": "Round {round} of {total} · {name}",
  "game.hit": "{loser} hit the target — {winner} wins the round",
  "game.tie": "Only the target is left — nobody fell for it. Tie!",
  "game.image": "Image",
  "game.imageTitle": "Show image",
  "game.rating": "Rating: {value}",
  "game.undoConfirmTitle": "Undo last move?",
  "game.undoConfirm": "“{title}” comes back into play, {team} gets the turn back and the points for that move are taken back.",
  "game.undoOk": "Undo",
  "game.draw": "It’s a draw!",
  "game.winsMatch": "{team} wins the match!",
  "game.stay": "Stay here",
  "game.toMenu": "Back to menu",
  "game.prev": "Previous",
  "game.nextCard": "Next",

  "editor.rounds": "Rounds",
  "editor.new": "+ New",
  "editor.export": "Export",
  "editor.import": "Import",
  "editor.type": "Round type",
  "editor.typeRated": "Rated — lowest rating is the target",
  "editor.typeManual": "Manual — host marks the target",
  "editor.typeCarousel": "Carousel — picture cards, host marks the target",
  "editor.name": "Round name",
  "editor.namePlaceholder": "e.g. Movies — worst rated",
  "editor.prompt": "Prompt shown to players",
  "editor.promptPlaceholder": "e.g. Find the lowest-rated movie.",
  "editor.bgImage": "Background image (optional)",
  "editor.items": "Items",
  "editor.hintRated": "Title + rating. Lowest rating is the target. Image optional.",
  "editor.hintCarousel": "Title + hidden info + image (required). Pick the target with ◉.",
  "editor.hintManual": "Title + hidden info. Pick the target with ◉. Image optional.",
  "editor.item": "Item {n}",
  "editor.itemTitle": "Item {n} title",
  "editor.rating": "Rating",
  "editor.itemRating": "Item {n} rating",
  "editor.secret": "Hidden info",
  "editor.itemSecret": "Item {n} hidden info",
  "editor.target": "Target (the one to avoid)",
  "editor.image": "Image",
  "editor.replace": "Replace",
  "editor.removeImage": "Remove image",
  "editor.save": "Save",
  "editor.duplicate": "Duplicate",
  "editor.delete": "Delete",
  "editor.unsaved": "Unsaved changes",
  "editor.discardTitle": "Discard changes?",
  "editor.discardText": "This round has unsaved changes.",
  "editor.discard": "Discard",
  "editor.empty": "No rounds yet. Fill in the form and press Save.",
  "editor.saved": "Saved ✓",
  "editor.deleteTitle": "Delete round?",
  "editor.deleteText": "“{name}” will be deleted permanently.",
  "editor.deleted": "Deleted",
  "editor.copy": "{name} (copy)",
  "editor.exporting": "Preparing export…",
  "editor.exported": "Exported {n} rounds",
  "editor.badJson": "That file is not valid JSON.",
  "editor.badFile": "This is not an Eliminator’s Gambit export file.",
  "editor.importTitle": "Import rounds?",
  "editor.importText": "{n} rounds will be added to this game set.",
  "editor.importing": "Importing {i} / {n}…",
  "editor.imported": "Imported {ok} of {n}",
  "editor.skipped": "Some rounds were skipped",

  "img.tooLarge": "Image is too large (max 15 MB).",
  "img.unreadable": "Could not read that image.",
  "img.encode": "Could not encode image.",

  "builtin:movies.name": "Built-in: Worst movies",
  "builtin:movies.prompt": "Find the lowest-rated movie.",
};

const RU = {
  "app.title": "The Eliminator’s Gambit",
  "app.subtitle": "Выбивай осторожно. Один неверный тап — и раунд окончен.",
  "common.loading": "Загрузка…",
  "common.ok": "ОК",
  "common.cancel": "Отмена",
  "common.close": "Закрыть",
  "common.back": "Назад",
  "common.error": "Что-то пошло не так",
  "common.networkError": "Нет связи с сервером — проверь интернет.",
  "lang.switch": "EN",
  "lang.switchTitle": "Switch to English",

  "login.name": "Название набора",
  "login.namePlaceholder": "например, EDUARD",
  "login.nameHint": "4–16 латинских букв или цифр. Все на вечеринке используют одно и то же название.",
  "login.pin": "PIN",
  "login.choosePin": "Придумай PIN",
  "login.setPin": "Задай PIN",
  "login.newHint": "Новый набор. Поделись названием и PIN с тем, кто будет вести игру.",
  "login.legacyHint": "У этого набора ещё нет PIN — тот, что ты введёшь сейчас, будет его защищать.",
  "login.continue": "Продолжить",
  "login.login": "Войти",
  "login.create": "Создать набор",
  "login.expiredTitle": "Сеанс завершён",
  "login.expired": "Сеанс истёк. Войди заново.",

  "menu.resume": "Продолжить матч",
  "menu.newGame": "Новая игра",
  "menu.editor": "Редактор раундов",
  "menu.pin": "Сменить PIN",
  "menu.logout": "Выйти",
  "menu.resumeHint": "{team1} {score1} : {score2} {team2} · раунд {round} из {total}",
  "menu.rules": "Как играть",
  "menu.rule1": "Две команды по очереди выбивают по одному варианту.",
  "menu.rule2": "Где-то в списке спрятана цель — худший / самый низкий / лишний вариант.",
  "menu.rule3": "За каждый безопасный выбор команда получает +1. Выбить цель — −4, и раунд заканчивается.",
  "menu.rule4": "Если осталась только цель, на неё никто не попался — ничья.",
  "menu.rule5": "Ведущий нажал не то? «↶ Отменить» вернёт последний ход.",

  "pin.title": "Смена PIN для {name}",
  "pin.current": "Текущий PIN",
  "pin.new": "Новый PIN (от 4 символов)",
  "pin.hint": "На других устройствах придётся войти заново.",
  "pin.change": "Сменить",
  "pin.doneTitle": "PIN изменён",
  "pin.done": "В следующий раз входи с новым PIN.",

  "setup.team1": "Первая команда",
  "setup.team2": "Вторая команда",
  "setup.team1Default": "Команда 1",
  "setup.team2Default": "Команда 2",
  "setup.pick": "Выбери от 1 до 10 раундов. Порядок нажатия — порядок игры.",
  "setup.clear": "Сбросить",
  "setup.start": "Начать",
  "setup.noRounds": "Раундов пока нет — создай их в редакторе.",
  "setup.loading": "Загружаю раунды…",
  "setup.max": "Не больше {n} раундов за матч.",
  "setup.pickOne": "Выбери хотя бы один раунд.",
  "setup.timer": "Таймер хода",
  "setup.timerOff": "Выключен",
  "setup.timerHint": "Просто обратный отсчёт с сигналом — что делать, когда время вышло, решает ведущий.",
  "game.timeUp": "Время вышло!",
  "fx.sound": "Звук вкл/выкл",

  "kind.rated": "рейтинг",
  "kind.manual": "ручной",
  "kind.carousel": "карусель",

  "game.next": "Следующий раунд →",
  "game.undo": "↶ Отменить",
  "game.undoTitle": "Отменить последний ход (Ctrl+Z)",
  "game.menu": "Меню",
  "game.showAll": "Показать всё",
  "game.counter": "Раунд {round} из {total} · {name}",
  "game.hit": "{loser} выбили цель — раунд за {winner}",
  "game.tie": "Осталась только цель — никто не попался. Ничья!",
  "game.image": "Картинка",
  "game.imageTitle": "Показать картинку",
  "game.rating": "Рейтинг: {value}",
  "game.undoConfirmTitle": "Отменить последний ход?",
  "game.undoConfirm": "«{title}» вернётся в игру, ход снова за командой {team}, а очки за этот ход будут отменены.",
  "game.undoOk": "Отменить ход",
  "game.draw": "Ничья!",
  "game.winsMatch": "Победа: {team}!",
  "game.stay": "Остаться",
  "game.toMenu": "В меню",
  "game.prev": "Назад",
  "game.nextCard": "Вперёд",

  "editor.rounds": "Раунды",
  "editor.new": "+ Новый",
  "editor.export": "Экспорт",
  "editor.import": "Импорт",
  "editor.type": "Тип раунда",
  "editor.typeRated": "Рейтинг — цель с самым низким рейтингом",
  "editor.typeManual": "Ручной — цель отмечает ведущий",
  "editor.typeCarousel": "Карусель — карточки с картинками, цель отмечает ведущий",
  "editor.name": "Название раунда",
  "editor.namePlaceholder": "например, Фильмы — худший рейтинг",
  "editor.prompt": "Задание для игроков",
  "editor.promptPlaceholder": "например, Найдите фильм с самым низким рейтингом.",
  "editor.bgImage": "Фоновая картинка (необязательно)",
  "editor.items": "Варианты",
  "editor.hintRated": "Название + рейтинг. Цель — самый низкий рейтинг. Картинка по желанию.",
  "editor.hintCarousel": "Название + скрытая подсказка + картинка (обязательно). Цель отметь кружком ◉.",
  "editor.hintManual": "Название + скрытая подсказка. Цель отметь кружком ◉. Картинка по желанию.",
  "editor.item": "Вариант {n}",
  "editor.itemTitle": "Название варианта {n}",
  "editor.rating": "Рейтинг",
  "editor.itemRating": "Рейтинг варианта {n}",
  "editor.secret": "Скрытая подсказка",
  "editor.itemSecret": "Подсказка варианта {n}",
  "editor.target": "Цель (то, что выбивать нельзя)",
  "editor.image": "Картинка",
  "editor.replace": "Заменить",
  "editor.removeImage": "Убрать картинку",
  "editor.save": "Сохранить",
  "editor.duplicate": "Дублировать",
  "editor.delete": "Удалить",
  "editor.unsaved": "Есть несохранённые изменения",
  "editor.discardTitle": "Отменить изменения?",
  "editor.discardText": "В этом раунде есть несохранённые изменения.",
  "editor.discard": "Не сохранять",
  "editor.empty": "Раундов пока нет. Заполни форму и нажми «Сохранить».",
  "editor.saved": "Сохранено ✓",
  "editor.deleteTitle": "Удалить раунд?",
  "editor.deleteText": "«{name}» будет удалён навсегда.",
  "editor.deleted": "Удалено",
  "editor.copy": "{name} (копия)",
  "editor.exporting": "Готовлю экспорт…",
  "editor.importTitle": "Импортировать раунды?",
  "editor.importing": "Импорт {i} / {n}…",
  "editor.imported": "Импортировано {ok} из {n}",
  "editor.badJson": "Файл не похож на JSON.",
  "editor.badFile": "Это не файл экспорта Eliminator’s Gambit.",
  "editor.skipped": "Часть раундов пропущена",

  "img.tooLarge": "Картинка слишком большая (максимум 15 МБ).",
  "img.unreadable": "Не получилось прочитать картинку.",
  "img.encode": "Не получилось сжать картинку.",

  "builtin:movies.name": "Встроенный: худшие фильмы",
  "builtin:movies.prompt": "Найдите фильм с самым низким рейтингом.",
};

// Russian plural forms: [1, 2–4, 5+]
function ruPlural(n, [one, few, many]) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
const RU_PLURALS = {
  "items.count": (n) => `${n} ${ruPlural(n, ["вариант", "варианта", "вариантов"])}`,
  "editor.exported": (n) => `Экспортировано: ${n} ${ruPlural(n, ["раунд", "раунда", "раундов"])}`,
  "editor.importText": (n) => `В набор будет добавлено ${n} ${ruPlural(n, ["раунд", "раунда", "раундов"])}.`,
};

function detect() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch {
    /* ignore */
  }
  return (navigator.languages || [navigator.language || "en"]).some((l) => /^(ru|be|uk|kk)\b/i.test(l)) ? "ru" : "en";
}

export let lang = detect();

export function t(key, params = {}) {
  if (lang === "ru" && RU_PLURALS[key] && params.n != null) return RU_PLURALS[key](params.n);
  const dict = lang === "ru" ? RU : EN;
  const s = dict[key] ?? EN[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`));
}

/** Fills elements marked with data-i18n / data-i18n-placeholder / data-i18n-title / data-i18n-aria-label. */
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll("[data-i18n-aria-label]")) el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel));
  document.documentElement.lang = lang;
  document.title = t("app.title");
}

const listeners = new Set();
export const onLangChange = (fn) => listeners.add(fn);

export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    /* ignore */
  }
  applyStatic();
  for (const fn of listeners) fn(lang);
}

// ---------- server/client error messages ----------

const RU_EXACT = {
  "Game set name must be 4–16 characters: letters, digits, - or _": "Название набора: 4–16 символов — латинские буквы, цифры, - или _",
  "Game set not found": "Набор не найден",
  "Game set was just created by someone else": "Такой набор только что создал кто-то другой",
  "Wrong PIN": "Неверный PIN",
  "Wrong current PIN": "Неверный текущий PIN",
  "Not logged in": "Нужно войти",
  "Session expired, please log in again": "Сеанс истёк, войди заново",
  "Request body too large": "Слишком большой запрос",
  "Invalid JSON body": "Некорректный запрос",
  "Invalid body": "Некорректный запрос",
  "Unknown round type": "Неизвестный тип раунда",
  "items must be an array": "Некорректный список вариантов",
  "Mark exactly one item as the target": "Отметь ровно один вариант как цель",
  "Round not found": "Раунд не найден",
  "Unknown image id — upload it first": "Картинка не найдена — загрузи её заново",
  "Invalid image id": "Некорректная картинка",
  "Empty image": "Пустая картинка",
  "Image is too large (max 1.5 MB after compression)": "Картинка слишком большая (максимум 1,5 МБ после сжатия)",
  "Unsupported image format (use JPEG, PNG, WebP or GIF)": "Неподдерживаемый формат (нужен JPEG, PNG, WebP или GIF)",
  "Invalid round list": "Некорректный список раундов",
  "Some selected rounds no longer exist": "Некоторые выбранные раунды уже удалены",
  "Match not found": "Матч не найден",
  "This match is over": "Матч уже закончен",
  "Round already finished": "Раунд уже закончен",
  "Item not found": "Вариант не найден",
  "Item already eliminated": "Этот вариант уже выбит",
  "The round changed meanwhile — refreshing": "Раунд изменился на другом устройстве — обновляю",
  "Finish the current round first": "Сначала закончите текущий раунд",
  "This was the last round": "Это был последний раунд",
  "Nothing to undo in this round": "В этом раунде нечего отменять",
  "Rated round has no ratings": "В раунде нет рейтингов",
  "Not found": "Не найдено",
  "Method not allowed": "Метод не поддерживается",
  "Cross-origin request blocked": "Запрос с чужого сайта заблокирован",
  "Internal server error": "Ошибка сервера",
};

const RU_FIELDS = {
  "Round name": "Название раунда",
  Prompt: "Задание",
  PIN: "PIN",
  "Team 1 name": "Название первой команды",
  "Team 2 name": "Название второй команды",
};
function ruField(f) {
  const m = /^Item (\d+) (title|rating|hidden info)$/.exec(f);
  if (m) return `Вариант ${m[1]}: ${{ title: "название", rating: "рейтинг", "hidden info": "подсказка" }[m[2]]}`;
  return RU_FIELDS[f] ?? f;
}

const RU_PATTERNS = [
  [/^Too many wrong PINs\. Try again in (\d+) min\.$/, (m) => `Слишком много неверных PIN. Попробуй через ${m[1]} мин.`],
  [/^PIN must be at least (\d+) characters$/, (m) => `PIN — минимум ${m[1]} символа`],
  [/^A round needs at least (\d+) items$/, (m) => `В раунде должно быть хотя бы ${m[1]} варианта`],
  [/^A round can have at most (\d+) items$/, (m) => `В раунде может быть не больше ${m[1]} вариантов`],
  [/^Item (\d+): title is required$/, (m) => `Вариант ${m[1]}: нужно название`],
  [/^Item (\d+): numeric rating is required$/, (m) => `Вариант ${m[1]}: нужен числовой рейтинг`],
  [/^Item (\d+): hidden info is required$/, (m) => `Вариант ${m[1]}: нужна скрытая подсказка`],
  [/^Item (\d+): image is required for carousel rounds$/, (m) => `Вариант ${m[1]}: в карусели нужна картинка`],
  [/^Pick from 1 to (\d+) rounds$/, (m) => `Выбери от 1 до ${m[1]} раундов`],
  [/^Unknown round source: (.+)$/, (m) => `Неизвестный раунд: ${m[1]}`],
  [/^Unknown built-in round: (.+)$/, (m) => `Неизвестный встроенный раунд: ${m[1]}`],
  [/^Round "(.+)" is invalid: (.+)$/, (m) => `Раунд «${m[1]}» заполнен неверно: ${translateError(m[2])}`],
  [/^Unknown (match|round|id)$/, () => "Не найдено"],
  [/^(.+) is required$/, (m) => `${ruField(m[1])}: обязательное поле`],
  [/^(.+) must be a string$/, (m) => `${ruField(m[1])}: должна быть строка`],
  [/^(.+) must be a number$/, (m) => `${ruField(m[1])}: должно быть число`],
  [/^(.+) is too long \(max (\d+)\)$/, (m) => `${ruField(m[1])}: слишком длинно (максимум ${m[2]})`],
];

/** Translates an English error message (from the server or our own code) into the UI language. */
export function translateError(msg) {
  const s = String(msg ?? "");
  if (lang !== "ru") return s;
  if (RU_EXACT[s]) return RU_EXACT[s];
  for (const [re, fn] of RU_PATTERNS) {
    const m = re.exec(s);
    if (m) return fn(m);
  }
  return s;
}
