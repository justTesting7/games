import { WORDS } from "./src/words.js";

const ROWS = 6;
const COLS = 5;
const STORAGE_KEY = "hebrew-wordle-state";

const HEBREW_LETTER = /[\u05D0-\u05EA\u05DA\u05DD\u05DF\u05E3\u05E5]/;

const KEYBOARD_ROWS = [
  ["פ", "ם", "ן", "ט", "א", "ר", "ק"],
  ["ף", "ך", "ל", "ח", "י", "ע", "כ", "ג", "ד", "ש"],
  ["ץ", "ת", "צ", "מ", "נ", "ה", "ב", "ס", "ז"],
];

const boardEl = document.getElementById("board");
const keyboardEl = document.getElementById("keyboard");
const messageEl = document.getElementById("message");
const helpDialog = document.getElementById("help-dialog");
const resultDialog = document.getElementById("result-dialog");

function splitHebrew(word) {
  return [...word].filter((ch) => HEBREW_LETTER.test(ch));
}

function getDayIndex(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  const day = Math.floor(diff / (1000 * 60 * 60 * 24));
  return day % WORDS.length;
}

function getTodayAnswer() {
  return WORDS[getDayIndex()];
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    const today = new Date().toDateString();
    if (state.date !== today) return null;
    return state;
  } catch {
    return null;
  }
}

function saveState(state) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...state, date: new Date().toDateString() })
  );
}

function evaluateGuess(guess, answer) {
  const guessLetters = splitHebrew(guess);
  const answerLetters = splitHebrew(answer);
  const result = Array(COLS).fill("absent");
  const remaining = {};

  for (const letter of answerLetters) {
    remaining[letter] = (remaining[letter] || 0) + 1;
  }

  for (let i = 0; i < COLS; i++) {
    if (guessLetters[i] === answerLetters[i]) {
      result[i] = "correct";
      remaining[guessLetters[i]]--;
    }
  }

  for (let i = 0; i < COLS; i++) {
    if (result[i] === "correct") continue;
    const letter = guessLetters[i];
    if (remaining[letter] > 0) {
      result[i] = "present";
      remaining[letter]--;
    }
  }

  return result;
}

function createBoard() {
  boardEl.innerHTML = "";
  const tiles = [];

  for (let r = 0; r < ROWS; r++) {
    const rowEl = document.createElement("div");
    rowEl.className = "row";
    rowEl.setAttribute("role", "row");

    const rowTiles = [];
    for (let c = 0; c < COLS; c++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.setAttribute("role", "gridcell");
      rowEl.appendChild(tile);
      rowTiles.push(tile);
    }

    boardEl.appendChild(rowEl);
    tiles.push(rowTiles);
  }

  return tiles;
}

function createKeyboard(onKey) {
  keyboardEl.innerHTML = "";

  for (const row of KEYBOARD_ROWS) {
    const rowEl = document.createElement("div");
    rowEl.className = "kb-row";

    for (const key of row) {
      const btn = document.createElement("button");
      btn.className = "key";
      btn.textContent = key;
      btn.dataset.key = key;
      btn.addEventListener("click", () => onKey(key));
      rowEl.appendChild(btn);
    }

    keyboardEl.appendChild(rowEl);
  }

  const actionRow = document.createElement("div");
  actionRow.className = "kb-row";

  const enterBtn = document.createElement("button");
  enterBtn.className = "key wide";
  enterBtn.textContent = "שליחה";
  enterBtn.addEventListener("click", () => onKey("Enter"));

  const backBtn = document.createElement("button");
  backBtn.className = "key wide";
  backBtn.textContent = "מחיקה";
  backBtn.addEventListener("click", () => onKey("Backspace"));

  actionRow.append(enterBtn, backBtn);
  keyboardEl.appendChild(actionRow);
}

function updateKeyboardStates(keyStates) {
  for (const btn of keyboardEl.querySelectorAll(".key[data-key]")) {
    const letter = btn.dataset.key;
    const state = keyStates[letter];
    btn.classList.remove("correct", "present", "absent");
    if (state) btn.classList.add(state);
  }
}

function showMessage(text, duration = 2000) {
  messageEl.textContent = text;
  if (duration > 0) {
    window.clearTimeout(showMessage._timer);
    showMessage._timer = window.setTimeout(() => {
      messageEl.textContent = "";
    }, duration);
  }
}

function showResult(won, answer, row) {
  document.getElementById("result-title").textContent = won
    ? "כל הכבוד!"
    : "נגמרו הניסיונות";
  document.getElementById("result-word").textContent = `המילה הייתה: ${answer}`;
  document.getElementById("result-stats").textContent = won
    ? `פתרתם ב-${row + 1} ניסיונות`
    : "נסו שוב מחר!";
  resultDialog.showModal();
}

function buildShareText(guesses, results, won, row) {
  const day = getDayIndex() + 1;
  const header = `וורדל עברית ${day} ${won ? row + 1 : "X"}/6`;
  const grid = results
    .map((rowResult) =>
      rowResult
        .map((s) => (s === "correct" ? "🟩" : s === "present" ? "🟨" : "⬛"))
        .join("")
    )
    .join("\n");
  return `${header}\n\n${grid}`;
}

function init() {
  const answer = getTodayAnswer();
  const tiles = createBoard();
  const saved = loadState();

  let row = 0;
  let col = 0;
  let currentGuess = "";
  let gameOver = false;
  const guesses = [];
  const results = [];
  const keyStates = {};

  function mergeKeyState(letter, state) {
    const rank = { absent: 0, present: 1, correct: 2 };
    if (!keyStates[letter] || rank[state] > rank[keyStates[letter]]) {
      keyStates[letter] = state;
    }
  }

  function renderCurrentRow() {
    const letters = splitHebrew(currentGuess);
    for (let c = 0; c < COLS; c++) {
      const tile = tiles[row][c];
      tile.textContent = letters[c] || "";
      tile.classList.toggle("filled", Boolean(letters[c]));
      tile.classList.remove("correct", "present", "absent", "flip", "shake");
    }
  }

  function restore(savedState) {
    row = savedState.row;
    gameOver = savedState.gameOver;
    guesses.push(...savedState.guesses);
    results.push(...savedState.results);

    for (let r = 0; r < savedState.guesses.length; r++) {
      const letters = splitHebrew(savedState.guesses[r]);
      for (let c = 0; c < COLS; c++) {
        const tile = tiles[r][c];
        tile.textContent = letters[c] || "";
        tile.classList.add("filled", savedState.results[r][c]);
      }
      for (let c = 0; c < COLS; c++) {
        mergeKeyState(letters[c], savedState.results[r][c]);
      }
    }

    updateKeyboardStates(keyStates);

    if (gameOver) {
      showResult(savedState.won, answer, savedState.won ? row - 1 : ROWS - 1);
    }
  }

  function persist() {
    saveState({
      row,
      gameOver,
      won: gameOver && guesses[guesses.length - 1] === answer,
      guesses,
      results,
    });
  }

  async function submitGuess() {
    const letters = splitHebrew(currentGuess);
    if (letters.length < COLS) {
      showMessage("חסרות אותיות");
      tiles[row].forEach((t) => t.classList.add("shake"));
      return;
    }

    if (!WORDS.includes(currentGuess)) {
      showMessage("מילה לא ברשימה");
      tiles[row].forEach((t) => t.classList.add("shake"));
      return;
    }

    const evaluation = evaluateGuess(currentGuess, answer);
    guesses.push(currentGuess);
    results.push(evaluation);

    for (let c = 0; c < COLS; c++) {
      const tile = tiles[row][c];
      tile.classList.add("flip");
      await new Promise((r) => setTimeout(r, 280));
      tile.classList.add(evaluation[c]);
      mergeKeyState(letters[c], evaluation[c]);
      await new Promise((r) => setTimeout(r, 120));
    }

    updateKeyboardStates(keyStates);

    const won = currentGuess === answer;
    if (won) {
      gameOver = true;
      persist();
      showMessage("מצוין!", 0);
      showResult(true, answer, row);
      return;
    }

    row++;
    col = 0;
    currentGuess = "";

    if (row >= ROWS) {
      gameOver = true;
      persist();
      showResult(false, answer, row - 1);
      return;
    }

    persist();
  }

  function handleKey(key) {
    if (gameOver) return;

    if (key === "Enter") {
      submitGuess();
      return;
    }

    if (key === "Backspace") {
      const letters = splitHebrew(currentGuess);
      letters.pop();
      currentGuess = letters.join("");
      col = letters.length;
      renderCurrentRow();
      return;
    }

    if (!HEBREW_LETTER.test(key)) return;

    if (col >= COLS) return;

    const letters = splitHebrew(currentGuess);
    letters.push(key);
    currentGuess = letters.join("");
    col = letters.length;
    renderCurrentRow();
  }

  createKeyboard(handleKey);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleKey("Enter");
    else if (e.key === "Backspace") handleKey("Backspace");
    else if (HEBREW_LETTER.test(e.key)) handleKey(e.key);
  });

  document.getElementById("help-btn").addEventListener("click", () => {
    helpDialog.showModal();
  });

  document.getElementById("close-help").addEventListener("click", () => {
    helpDialog.close();
  });

  document.getElementById("close-result").addEventListener("click", () => {
    resultDialog.close();
  });

  document.getElementById("share-btn").addEventListener("click", async () => {
    const text = buildShareText(
      guesses,
      results,
      guesses[guesses.length - 1] === answer,
      row
    );
    try {
      await navigator.clipboard.writeText(text);
      showMessage("הועתק!");
    } catch {
      showMessage("לא ניתן להעתיק");
    }
  });

  if (saved) {
    restore(saved);
  }
}

init();
