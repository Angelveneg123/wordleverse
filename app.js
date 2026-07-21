// app.js - Wordle Online Competitivo

import { db } from "./firebase-config.js";

import {
  ref,
  update,
  push,
  onValue,
  off,
  set,
  get,
  query,
  orderByChild,
  equalTo
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

import {
  THEMES,
  DIFFICULTIES,
  MODES,
  getWordForRoom
} from "./words.js";

let currentRoomCode = null;
let currentPlayerId = null;
let currentPlayerName = null;
let isHost = false;
let currentWord = "";
let currentWordLength = 5;

let roomRef = null;

// Selecciones del formulario de creación
let selectedDifficulty = "normal";
let selectedMode = "clasico";
let selectedTheme = "aleatorio";
let isPublicSelected = true;

// Referencia y estado de la sala a la que se quiere unir desde el lobby público
let pendingJoinCode = null;
let pendingJoinHasPassword = false;

// Listener de salas públicas (para poder desconectarlo al salir de esa pantalla)
let publicRoomsRef = null;
let publicRoomsCallback = null;

// Listener de la sala activa (para poder desconectarlo al salir)
let roomListenerCallback = null;

// Controla que el tablero solo se reinicie cuando cambia la ronda
let lastRoundLoaded = null;
let lastWordLoaded = null;

// Última foto conocida de la sala (para el ticker de tiempo) y control
// de que solo un timeout se procese a la vez
let latestRoomSnapshot = null;
let timeoutHandling = false;
let gameTickInterval = null;

// Modos que necesitan un límite de tiempo por ronda
const TIMED_MODES = ["contrarreloj", "eliminacion"];
const DEFAULT_ROUND_SECONDS = 45;

function needsTimer(mode) {
  return TIMED_MODES.includes(mode);
}

function getEffectiveSeconds(room) {
  if (!needsTimer(room.mode)) return 0;
  return room.timePerRound > 0 ? room.timePerRound : DEFAULT_ROUND_SECONDS;
}

function computeRoundDeadline(room) {
  const seconds = getEffectiveSeconds(room);
  return seconds > 0 ? Date.now() + seconds * 1000 : null;
}

// ==================== SESIÓN (reconexión) ====================

const SESSION_KEY = "wordleSession";

function saveSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      roomCode: currentRoomCode,
      playerId: currentPlayerId,
      playerName: currentPlayerName
    }));
  } catch (e) { /* localStorage no disponible, seguimos sin persistencia */ }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (e) { /* nada que limpiar */ }
}

function resetLocalState() {
  currentRoomCode = null;
  currentPlayerId = null;
  isHost = false;
  currentWord = "";
  currentWordLength = 5;
  roomRef = null;
  lastRoundLoaded = null;
  lastWordLoaded = null;
  board = [];
  currentRow = 0;
}

// Al cargar la página, si había una sesión guardada intentamos volver
// directo a la sala donde estábamos (lobby, ronda en curso, resultado o final).
async function attemptReconnect() {
  const session = loadSession();
  if (!session || !session.roomCode || !session.playerId) return false;

  currentRoomCode = session.roomCode;
  currentPlayerId = session.playerId;
  currentPlayerName = session.playerName;

  roomRef = ref(db, "rooms/" + currentRoomCode);

  let room = null;
  try {
    const snapshot = await get(roomRef);
    room = snapshot.val();
  } catch (e) {
    room = null;
  }

  if (!room || !room.players || !room.players[currentPlayerId]) {
    clearSession();
    resetLocalState();
    return false;
  }

  const nameInput = document.getElementById("player-name");
  if (nameInput) nameInput.value = currentPlayerName || "";

  isHost = !!room.players[currentPlayerId].isHost;

  if (room.status === "playing" && room.roundStatus === "playing") {
    lastRoundLoaded = room.currentRound;
    lastWordLoaded = room.currentWord;
    startGameClient(room);
  } else if (room.roundStatus === "finished" && room.status !== "gameOver") {
    showRoundResult(room);
  } else if (room.status === "gameOver") {
    showFinalScreen(room);
  } else {
    showLobby(room);
  }

  listenToRoomChanges();
  return true;
}

// ==================== UTILIDADES ====================

const AVATAR_COLORS = ["#ff6b4a", "#7c6cf0", "#22d3ee", "#f472b6", "#60a5fa", "#2dd4bf"];

function avatarColorFor(playerId) {
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) {
    hash = (hash * 31 + playerId.charCodeAt(i)) % AVATAR_COLORS.length;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function generateRoomCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";

  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  return code;
}

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach(screen => {
    screen.classList.add("hidden");
    screen.classList.remove("screen-anim");
  });

  const target = document.getElementById(screenId);
  target.classList.remove("hidden");

  // Forzar reflow para poder relanzar la animación cada vez
  void target.offsetWidth;
  target.classList.add("screen-anim");
}

function showError(message, targetId = "error-msg-start") {
  const errorEl = document.getElementById(targetId);

  if (errorEl) {
    errorEl.textContent = message;

    setTimeout(() => {
      errorEl.textContent = "";
    }, 4000);

  } else {
    alert(message);
  }
}

function getPlayerName() {
  return document.getElementById("player-name").value.trim();
}

// ==================== NAVEGACIÓN ====================

function goToCreate() {
  const name = getPlayerName();
  if (!name) return showError("Debes escribir tu nombre primero", "error-msg-start");

  showScreen("screen-create");
}

function goToPublicRooms() {
  const name = getPlayerName();
  if (!name) return showError("Debes escribir tu nombre primero", "error-msg-start");

  showScreen("screen-public-rooms");
  startBrowsingPublicRooms();
}

function goToJoinByCode() {
  const name = getPlayerName();
  if (!name) return showError("Debes escribir tu nombre primero", "error-msg-start");

  pendingJoinCode = null;
  pendingJoinHasPassword = false;

  const codeInput = document.getElementById("room-code");
  const passInput = document.getElementById("join-password");
  codeInput.value = "";
  codeInput.readOnly = false;
  passInput.value = "";

  showScreen("screen-join-code");
}

function backToStart() {
  stopBrowsingPublicRooms();
  showScreen("screen-start");
}

function backToStartFromCreate() {
  showScreen("screen-start");
}

// ==================== FORMULARIO DE CREACIÓN ====================

function populateCreateForm() {
  // Tema
  const themeSelect = document.getElementById("create-theme");
  themeSelect.innerHTML = "";
  Object.entries(THEMES).forEach(([key, meta]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${meta.icon} ${meta.label}`;
    if (key === selectedTheme) opt.selected = true;
    themeSelect.appendChild(opt);
  });

  // Dificultad
  const diffContainer = document.getElementById("create-difficulty");
  diffContainer.innerHTML = "";
  Object.entries(DIFFICULTIES).forEach(([key, meta]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-btn" + (key === selectedDifficulty ? " active" : "");
    btn.dataset.key = key;

    const lengthLabel = meta.lengths.length === 1
      ? `${meta.lengths[0]} letras`
      : `${meta.lengths[0]}-${meta.lengths[meta.lengths.length - 1]} letras`;

    btn.innerHTML = `${meta.icon} ${meta.label}<span class="pill-sub">${lengthLabel}</span>`;
    btn.onclick = () => selectDifficulty(key);
    diffContainer.appendChild(btn);
  });

  // Modo de juego
  const modeContainer = document.getElementById("create-mode");
  modeContainer.innerHTML = "";
  Object.entries(MODES).forEach(([key, meta]) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "mode-card" + (key === selectedMode ? " active" : "") + (meta.enabled ? "" : " disabled");
    card.innerHTML = `
      <span class="mode-name">${meta.label}</span>
      <span class="mode-desc">${meta.description}</span>
      ${meta.enabled ? "" : '<span class="mode-soon">Próximamente</span>'}
    `;

    if (meta.enabled) {
      card.onclick = () => selectMode(key);
    } else {
      card.disabled = true;
    }

    modeContainer.appendChild(card);
  });

  // Tiempo por ronda
  const timeSelect = document.getElementById("create-time");
  timeSelect.innerHTML = "";
  [
    [0, "Sin límite"],
    [30, "30 segundos"],
    [60, "60 segundos"],
    [90, "90 segundos"],
    [120, "120 segundos"]
  ].forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    timeSelect.appendChild(opt);
  });
}

function selectDifficulty(key) {
  selectedDifficulty = key;
  document.querySelectorAll("#create-difficulty .pill-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.key === key);
  });
}

function selectMode(key) {
  if (!MODES[key] || !MODES[key].enabled) return;
  selectedMode = key;
  document.querySelectorAll("#create-mode .mode-card").forEach((card, index) => {
    const cardKey = Object.keys(MODES)[index];
    card.classList.toggle("active", cardKey === key);
  });

  const hint = document.getElementById("time-mode-hint");
  if (hint) {
    if (TIMED_MODES.includes(key)) {
      hint.textContent = `⏱ Este modo necesita un límite de tiempo. Si eliges "Sin límite" usaremos ${DEFAULT_ROUND_SECONDS}s por defecto.`;
      hint.classList.remove("hidden");
    } else {
      hint.classList.add("hidden");
    }
  }
}

function toggleVisibility() {
  isPublicSelected = !isPublicSelected;
  const toggle = document.getElementById("visibility-toggle");
  const label = document.getElementById("visibility-label");

  toggle.classList.toggle("is-public", isPublicSelected);
  label.textContent = isPublicSelected
    ? "🌍 Pública — cualquiera la verá en la lista de salas"
    : "🔒 Privada — solo entra quien tenga el código";
}

// ==================== CREAR SALA ====================

async function createRoom() {

  const name = getPlayerName();

  if (!name) {
    showScreen("screen-start");
    return showError("Debes escribir tu nombre", "error-msg-start");
  }

  currentPlayerName = name;
  currentRoomCode = generateRoomCode();
  currentPlayerId = "player_" + Date.now();

  const roomNameInput = document.getElementById("create-room-name").value.trim();
  const roomName = roomNameInput || `Sala de ${name}`;

  const rounds = parseInt(document.getElementById("create-rounds").value, 10) || 5;
  const totalRounds = Math.min(Math.max(rounds, 3), 15);

  const timePerRound = parseInt(document.getElementById("create-time").value, 10) || 0;
  const password = document.getElementById("create-password").value.trim();

  roomRef = ref(db, "rooms/" + currentRoomCode);

  const roomData = {
    roomCode: currentRoomCode,
    roomName,
    hostId: currentPlayerId,
    hostName: currentPlayerName,
    isPublic: isPublicSelected,
    password: password || null,
    theme: document.getElementById("create-theme").value,
    difficulty: selectedDifficulty,
    mode: selectedMode,
    timePerRound,
    status: "waiting",
    currentRound: 0,
    totalRounds,
    currentWord: "",
    currentWordLength: DIFFICULTIES[selectedDifficulty].lengths[0],
    roundWinner: null,
    roundStatus: "waiting",
    createdAt: Date.now(),
    playerCount: 1,
    players: {}
  };

  roomData.players[currentPlayerId] = {
    id: currentPlayerId,
    name: currentPlayerName,
    score: 0,
    attempts: [],
    eliminated: false,
    isHost: true,
    joinedAt: Date.now()
  };

  await set(roomRef, roomData);

  isHost = true;

  saveSession();

  showLobby(roomData);

  listenToRoomChanges();
}

// ==================== SALAS PÚBLICAS ====================

// Una sala "waiting" que lleva muchas horas sin arrancar quedó abandonada
// (el anfitrión la creó y nunca volvió). Cualquier cliente que abra la
// lista de salas públicas la borra silenciosamente para todos.
const STALE_WAITING_MS = 6 * 60 * 60 * 1000;   // 6 horas sin iniciar
const STALE_ANY_MS = 48 * 60 * 60 * 1000;      // 48 horas en cualquier estado (partidas colgadas)

function isStaleRoom(room) {
  if (!room || !room.createdAt) return false;

  const age = Date.now() - room.createdAt;

  if (room.status === "waiting" && age > STALE_WAITING_MS) return true;
  if (age > STALE_ANY_MS) return true;

  return false;
}

function cleanupStaleRoom(room) {
  set(ref(db, "rooms/" + room.roomCode), null).catch(() => {
    // Si falla (p. ej. reglas de Firebase), simplemente lo intentará
    // otro cliente la próxima vez que abra la lista.
  });
}

function startBrowsingPublicRooms() {
  stopBrowsingPublicRooms();

  publicRoomsRef = query(ref(db, "rooms"), orderByChild("isPublic"), equalTo(true));

  publicRoomsCallback = snapshot => {
    const all = snapshot.val() || {};

    const rooms = [];

    Object.values(all).forEach(room => {
      if (isStaleRoom(room)) {
        cleanupStaleRoom(room);
        return;
      }

      if (room.status === "waiting") rooms.push(room);
    });

    rooms.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    renderPublicRooms(rooms);
  };

  onValue(publicRoomsRef, publicRoomsCallback);
}

function stopBrowsingPublicRooms() {
  if (publicRoomsRef && publicRoomsCallback) {
    off(publicRoomsRef, "value", publicRoomsCallback);
  }
  publicRoomsRef = null;
  publicRoomsCallback = null;
}

function renderPublicRooms(rooms) {
  const list = document.getElementById("public-rooms-list");
  const empty = document.getElementById("public-rooms-empty");

  list.innerHTML = "";

  if (!rooms.length) {
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  rooms.forEach(room => {
    const themeMeta = THEMES[room.theme] || THEMES.aleatorio;
    const diffMeta = DIFFICULTIES[room.difficulty] || DIFFICULTIES.normal;
    const modeMeta = MODES[room.mode] || MODES.clasico;
    const playerCount = Object.keys(room.players || {}).length;

    const card = document.createElement("div");
    card.className = "room-card";

    card.innerHTML = `
      <div class="room-card-top">
        <span class="room-card-theme">${themeMeta.icon}</span>
        <div class="room-card-info">
          <div class="room-card-name">${escapeHtml(room.roomName || "Sala sin nombre")}
            ${room.password ? '<span class="lock-icon" title="Con contraseña">🔒</span>' : ""}
          </div>
          <div class="room-card-host">Anfitrión: ${escapeHtml(room.hostName || "?")}</div>
        </div>
      </div>
      <div class="room-card-badges">
        <span class="chip">${diffMeta.icon} ${diffMeta.label}</span>
        <span class="chip">${modeMeta.label}${modeMeta.enabled ? "" : " · pronto"}</span>
        <span class="chip">👥 ${playerCount}</span>
        <span class="chip">🔁 ${room.totalRounds} rondas</span>
      </div>
    `;

    const joinBtn = document.createElement("button");
    joinBtn.textContent = "Entrar";
    joinBtn.onclick = () => joinPublicRoom(room.roomCode, !!room.password);

    card.appendChild(joinBtn);
    list.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function joinPublicRoom(code, hasPassword) {
  pendingJoinCode = code;
  pendingJoinHasPassword = hasPassword;

  const codeInput = document.getElementById("room-code");
  const passInput = document.getElementById("join-password");
  const passField = document.getElementById("join-password-field");

  codeInput.value = code;
  codeInput.readOnly = true;
  passInput.value = "";

  passField.classList.toggle("hidden", !hasPassword);

  showScreen("screen-join-code");
}

// ==================== UNIRSE POR CÓDIGO ====================

async function joinRoom() {

  const name = getPlayerName();

  const code = document
    .getElementById("room-code")
    .value
    .trim()
    .toUpperCase();

  const passwordInput = document.getElementById("join-password").value.trim();

  if (!name) {
    return showError("Debes escribir tu nombre", "error-msg-join");
  }

  if (!code) {
    return showError("Ingresa el código", "error-msg-join");
  }

  currentPlayerName = name;
  currentRoomCode = code;
  currentPlayerId = "player_" + Date.now();

  roomRef = ref(db, "rooms/" + currentRoomCode);

  const snapshot = await get(roomRef);

  const room = snapshot.val();

  if (!room) {
    return showError("La sala no existe", "error-msg-join");
  }

  if (room.status !== "waiting") {
    return showError("La partida ya comenzó", "error-msg-join");
  }

  if (room.password && room.password !== passwordInput) {
    return showError("Contraseña incorrecta", "error-msg-join");
  }

  const playerData = {
    id: currentPlayerId,
    name: currentPlayerName,
    score: 0,
    attempts: [],
    eliminated: false,
    isHost: false,
    joinedAt: Date.now()
  };

  await set(
    ref(
      db,
      "rooms/" +
      currentRoomCode +
      "/players/" +
      currentPlayerId
    ),
    playerData
  );

  await update(roomRef, {
    playerCount: Object.keys(room.players || {}).length + 1
  });

  isHost = false;

  saveSession();

  stopBrowsingPublicRooms();

  showLobby(room);

  listenToRoomChanges();
}

// ==================== LOBBY ====================

function showLobby(room) {

  showScreen("screen-lobby");

  const codeContainer = document.getElementById("room-code-display");

  codeContainer.innerHTML = "";

  currentRoomCode.split("").forEach(char => {
    const tile = document.createElement("div");
    tile.className = "code-tile";
    tile.textContent = char;
    codeContainer.appendChild(tile);
  });

  renderLobbyBadges(room);
}

function renderLobbyBadges(room) {
  const container = document.getElementById("lobby-badges");
  if (!container || !room) return;

  const themeMeta = THEMES[room.theme] || THEMES.aleatorio;
  const diffMeta = DIFFICULTIES[room.difficulty] || DIFFICULTIES.normal;
  const modeMeta = MODES[room.mode] || MODES.clasico;

  let passwordChip = "";
  if (room.password) {
    passwordChip = isHost
      ? '<button type="button" id="lobby-password-toggle" class="chip chip-password">🔑 ••••••</button>'
      : '<span class="chip">🔒 Con contraseña</span>';
  }

  container.innerHTML = `
    <span class="chip">${themeMeta.icon} ${themeMeta.label}</span>
    <span class="chip">${diffMeta.icon} ${diffMeta.label}</span>
    <span class="chip">${modeMeta.label}${modeMeta.enabled ? "" : " · próximamente"}</span>
    <span class="chip">🔁 ${room.totalRounds} rondas</span>
    <span class="chip">${room.timePerRound ? "⏱ " + room.timePerRound + "s" : "⏱ Sin límite"}</span>
    <span class="chip">${room.isPublic ? "🌍 Pública" : "🔒 Privada"}</span>
    ${passwordChip}
  `;

  // Solo el host puede revelar la contraseña real (los demás ya la escribieron para entrar)
  if (isHost && room.password) {
    const toggleBtn = document.getElementById("lobby-password-toggle");
    let revealed = false;
    toggleBtn.onclick = () => {
      revealed = !revealed;
      toggleBtn.textContent = revealed ? `🔑 ${room.password}` : "🔑 ••••••";
    };
  }
}

function copyRoomCode() {
  if (!currentRoomCode) return;

  navigator.clipboard
    ?.writeText(currentRoomCode)
    .then(() => {
      const btn = document.querySelector(".copy-code-btn");
      if (!btn) return;
      const original = btn.textContent;
      btn.textContent = "¡Copiado!";
      setTimeout(() => { btn.textContent = original; }, 1500);
    })
    .catch(() => {});
}

// ==================== ESCUCHAR CAMBIOS ====================

function listenToRoomChanges() {

  stopRoomListener();

  roomListenerCallback = snapshot => {

    const room = snapshot.val();

    if (!room) {
      // La sala ya no existe (por ejemplo, el host se fue y no quedaba nadie)
      stopRoomListener();
      clearSession();
      resetLocalState();
      showScreen("screen-start");
      return;
    }

    latestRoomSnapshot = room;
    startGameTicker();

    // Mantenemos isHost sincronizado con Firebase: si el host se va,
    // otro jugador puede pasar a ser host sin recargar la página.
    if (room.players && room.players[currentPlayerId]) {
      isHost = !!room.players[currentPlayerId].isHost;
    }

    renderPlayers(room.players);
    updateScores(room.players);
    renderLobbyBadges(room);
    updateSpectatorState(room);

    if (
      room.status === "playing" &&
      room.roundStatus === "playing"
    ) {
      const isNewRound =
        lastRoundLoaded !== room.currentRound ||
        lastWordLoaded !== room.currentWord;

      if (isNewRound) {
        lastRoundLoaded = room.currentRound;
        lastWordLoaded = room.currentWord;

        startGameClient(room);
      }
    }

    if (
      room.roundStatus === "finished" &&
      room.status !== "gameOver"
    ) {
      showRoundResult(room);
    }

    if (room.status === "gameOver") {
      showFinalScreen(room);
    }
  };

  onValue(roomRef, roomListenerCallback);
}

function stopRoomListener() {
  if (roomRef && roomListenerCallback) {
    off(roomRef, "value", roomListenerCallback);
  }
  roomListenerCallback = null;
}

// ==================== TICKER DE TIEMPO (Contrarreloj / Eliminación) ====================

function startGameTicker() {
  if (gameTickInterval) return;
  gameTickInterval = setInterval(gameTick, 1000);
}

function gameTick() {
  const room = latestRoomSnapshot;
  if (!room) return;

  updateRoundTimerDisplay(room);

  // Solo quien es host en este momento fuerza el fin de ronda por tiempo.
  // Como isHost se sincroniza en vivo con Firebase, si el host se va y el
  // rol pasa a otro jugador, ese jugador retoma el control automáticamente.
  if (!isHost) return;
  if (room.status !== "playing" || room.roundStatus !== "playing") return;
  if (!needsTimer(room.mode) || !room.roundDeadline) return;
  if (Date.now() < room.roundDeadline) return;

  handleRoundTimeout();
}

function updateRoundTimerDisplay(room) {
  const el = document.getElementById("round-timer");
  if (!el) return;

  const gameScreen = document.getElementById("screen-game");
  const showTimer =
    gameScreen && !gameScreen.classList.contains("hidden") &&
    room.status === "playing" && room.roundStatus === "playing" &&
    needsTimer(room.mode) && room.roundDeadline;

  if (!showTimer) {
    el.classList.add("hidden");
    return;
  }

  const secondsLeft = Math.max(0, Math.ceil((room.roundDeadline - Date.now()) / 1000));
  el.classList.remove("hidden");
  el.textContent = `⏱ ${secondsLeft}s`;
  el.classList.toggle("round-timer-urgent", secondsLeft <= 10);
}

async function handleRoundTimeout() {
  if (timeoutHandling) return;
  timeoutHandling = true;

  try {
    const snapshot = await get(roomRef);
    const room = snapshot.val();

    // Puede que alguien haya ganado justo antes de que corriéramos esto
    if (!room || room.roundStatus !== "playing") return;
    if (!needsTimer(room.mode) || !room.roundDeadline) return;
    if (Date.now() < room.roundDeadline) return;

    // Nadie acertó a tiempo: se revela la palabra y no se elimina a nadie
    // (red de seguridad para no vaciar la sala por mala suerte de todos).
    await update(roomRef, {
      roundStatus: "finished",
      roundWinner: null
    });

  } finally {
    timeoutHandling = false;
  }
}

// ==================== SALIR DE LA SALA ====================

async function leaveRoom() {

  if (!currentRoomCode || !currentPlayerId) {
    clearSession();
    showScreen("screen-start");
    return;
  }

  try {
    const snapshot = await get(roomRef);
    const room = snapshot.val();

    if (room) {
      const players = { ...(room.players || {}) };
      delete players[currentPlayerId];

      const remaining = Object.values(players);

      if (remaining.length === 0) {
        // No queda nadie en la sala: la eliminamos
        await set(roomRef, null);
      } else {
        const updates = {};
        updates[`players/${currentPlayerId}`] = null;
        updates.playerCount = remaining.length;

        if (isHost) {
          // Traspasamos el host al jugador más antiguo que quede
          const nextHost = remaining.sort(
            (a, b) => (a.joinedAt || 0) - (b.joinedAt || 0)
          )[0];

          updates[`players/${nextHost.id}/isHost`] = true;
          updates.hostId = nextHost.id;
        }

        await update(roomRef, updates);
      }
    }
  } catch (e) {
    // Si falla la limpieza remota igual dejamos la sala localmente
  }

  stopRoomListener();
  clearSession();
  resetLocalState();
  showScreen("screen-start");
}

function renderPlayers(players) {

  const list = document.getElementById("players-list");

  list.innerHTML = "";

  Object.values(players || {}).forEach(player => {

    const li = document.createElement("li");
    li.className = "player-row";

    const avatar = document.createElement("div");
    avatar.className = "avatar-tile";
    avatar.style.background = avatarColorFor(player.id);
    avatar.textContent = player.name.charAt(0).toUpperCase();

    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.name;

    li.appendChild(avatar);
    li.appendChild(name);

    if (player.isHost) {
      const crown = document.createElement("span");
      crown.className = "crown";
      crown.textContent = "👑";
      li.appendChild(crown);
    }

    list.appendChild(li);
  });

  const startBtn =
    document.getElementById("start-btn");

  if (isHost) {
    startBtn.classList.remove("hidden");
  } else {
    startBtn.classList.add("hidden");
  }
}

// ==================== INICIAR JUEGO ====================

async function startGame() {

  if (!isHost) return;

  const snapshot = await get(roomRef);

  const room = snapshot.val();

  if (Object.keys(room.players).length < 2) {
    return showError(
      "Necesitas mínimo 2 jugadores", "error-msg-start"
    );
  }

  const { word: firstWord, length } = getWordForRoom(room.theme, room.difficulty);

  const startUpdates = {
    status: "playing",
    currentRound: 1,
    currentWord: firstWord,
    currentWordLength: length,
    roundWinner: null,
    roundStatus: "playing",
    roundDeadline: computeRoundDeadline(room)
  };

  Object.keys(room.players).forEach(pid => {
    startUpdates[`players/${pid}/attempts`] = [];
    startUpdates[`players/${pid}/eliminated`] = false;
  });

  await update(roomRef, startUpdates);
}

function updateSpectatorState(room) {
  const gameScreen = document.getElementById("screen-game");
  if (!gameScreen || gameScreen.classList.contains("hidden")) return;

  const me = room.players && room.players[currentPlayerId];
  const amIEliminated = !!(me && me.eliminated);

  const spectatorBanner = document.getElementById("spectator-banner");
  const guessBar = document.getElementById("guess-bar");

  if (spectatorBanner) spectatorBanner.classList.toggle("hidden", !amIEliminated);
  if (guessBar) guessBar.classList.toggle("hidden", amIEliminated);
}

function startGameClient(room) {

  currentWord = room.currentWord;
  currentWordLength = room.currentWordLength || currentWord.length || 5;

  showScreen("screen-game");

  renderBoard(currentWordLength);

  const guessInput = document.getElementById("guess-input");
  guessInput.maxLength = currentWordLength;
  guessInput.value = "";

  const me = room.players && room.players[currentPlayerId];

  updateSpectatorState(room);

  updateScores(room.players);

  updateRoundInfo(room);
  updateRoundTimerDisplay(room);

  // Reconexión: si ya habíamos jugado intentos en esta ronda, los repintamos
  if (me && me.attempts) {
    const attempts = Object.values(me.attempts)
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    attempts.forEach(attempt => {
      showAttemptInBoard(attempt.word, attempt.result);
    });
  }
}

// ==================== SCORE ====================

function updateScores(players) {

  const container =
    document.getElementById(
      "scores-container"
    );

  if (!container) return;

  container.innerHTML = "";

  Object.values(players || {}).forEach(player => {

    const div = document.createElement("div");

    div.className = "player-score" + (player.eliminated ? " eliminated" : "");

    div.textContent = player.eliminated
      ? `❌ ${player.name}: ${player.score}`
      : `${player.name}: ${player.score}`;

    container.appendChild(div);
  });
}

function updateRoundInfo(room) {

  const roundInfo = document.getElementById("round-info");

  if (!roundInfo) return;

  roundInfo.textContent =
    `Ronda ${room.currentRound} de ${room.totalRounds}`;
}

// ==================== TABLERO ====================

let board = [];
let currentRow = 0;

function computeTileSize(length) {
  const gap = 6;
  const containerWidth = Math.min(document.querySelector(".screen").clientWidth - 40, 440);
  const rawSize = Math.floor((containerWidth - gap * (length - 1)) / length);
  return Math.max(28, Math.min(58, rawSize));
}

function renderBoard(length) {

  const boardEl =
    document.getElementById("game-board");

  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${length}, 1fr)`;
  boardEl.style.setProperty("--tile-size", computeTileSize(length) + "px");

  board = [];

  currentRow = 0;

  const maxAttempts = Math.min(length + 1, 11);

  for (let i = 0; i < maxAttempts; i++) {

    const row = [];

    for (let j = 0; j < length; j++) {

      const tile =
        document.createElement("div");

      tile.className = "tile";

      boardEl.appendChild(tile);

      row.push(tile);
    }

    board.push(row);
  }
}

// Recalcula solo el tamaño de las fichas (no el contenido) al girar
// el celular o redimensionar la ventana, para que el tablero siga
// respondiendo sin perder los intentos ya jugados.
let resizeTimeout = null;
function handleBoardResize() {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    const gameScreen = document.getElementById("screen-game");
    if (!gameScreen || gameScreen.classList.contains("hidden")) return;
    if (!currentWordLength) return;

    const boardEl = document.getElementById("game-board");
    boardEl.style.setProperty("--tile-size", computeTileSize(currentWordLength) + "px");
  }, 120);
}

// ==================== ENVIAR PALABRA ====================

async function submitGuess() {

  const input =
    document.getElementById("guess-input");

  const guess =
    input.value.trim().toUpperCase();

  if (guess.length !== currentWordLength) {
    return showError(
      `Debe tener ${currentWordLength} letras`, "error-msg-game"
    );
  }

  const snapshot = await get(roomRef);

  const room = snapshot.val();

  if (room.roundStatus !== "playing") {
    return showError("La ronda ya terminó", "error-msg-game");
  }

  const me = room.players && room.players[currentPlayerId];
  if (me && me.eliminated) {
    return showError("Ya fuiste eliminado — ahora eres espectador", "error-msg-game");
  }

  const result =
    checkGuess(guess, room.currentWord);

  await push(
    ref(
      db,
      "rooms/" +
      currentRoomCode +
      "/players/" +
      currentPlayerId +
      "/attempts"
    ),
    {
      word: guess,
      result,
      timestamp: Date.now()
    }
  );

  showAttemptInBoard(guess, result);

  input.value = "";

  if (guess === room.currentWord) {
    finishRound();
  }
}

// ==================== COMPROBAR ====================

function checkGuess(guess, secret) {

  const length = secret.length;

  const result =
    Array(length).fill("gray");

  const secretArr = secret.split("");

  for (let i = 0; i < length; i++) {

    if (guess[i] === secretArr[i]) {

      result[i] = "green";

      secretArr[i] = null;
    }
  }

  for (let i = 0; i < length; i++) {

    if (result[i] === "green") continue;

    const index =
      secretArr.indexOf(guess[i]);

    if (index !== -1) {

      result[i] = "yellow";

      secretArr[index] = null;
    }
  }

  return result;
}

function showAttemptInBoard(
  guess,
  result
) {

  const row = board[currentRow];

  if (!row) {
    return showError("Ya usaste todos los intentos", "error-msg-game");
  }

  for (let i = 0; i < guess.length; i++) {

    const tile = row[i];

    setTimeout(() => {
      tile.textContent = guess[i];
      tile.classList.add(result[i], "reveal");
    }, i * 120);
  }

  currentRow++;
}

// ==================== FINALIZAR RONDA ====================

async function finishRound() {

  const snapshot = await get(roomRef);

  const room = snapshot.val();

  if (room.roundStatus !== "playing") return;

  const updates = {
    roundWinner: currentPlayerId,
    roundStatus: "finished"
  };

  const players = room.players || {};
  const winnerScore = (players[currentPlayerId]?.score || 0) + 1;
  updates[`players/${currentPlayerId}/score`] = winnerScore;

  if (room.mode === "eliminacion") {
    // Todo el que seguía activo y no ganó esta ronda queda eliminado.
    const stillActive = Object.values(players).filter(p => !p.eliminated);
    const eliminatedNow = stillActive.filter(p => p.id !== currentPlayerId);

    // Red de seguridad: si por alguna razón eso vaciara la sala entera,
    // no eliminamos a nadie esta ronda (mejor que un juego sin jugadores).
    if (eliminatedNow.length < stillActive.length) {
      eliminatedNow.forEach(p => {
        updates[`players/${p.id}/eliminated`] = true;
      });

      const remainingActive = stillActive.length - eliminatedNow.length;

      if (remainingActive <= 1) {
        // Ya no queda con quién competir: termina la partida aquí mismo,
        // aunque falten rondas configuradas.
        updates.status = "gameOver";
      }
    }
  }

  await update(roomRef, updates);
}

// ==================== RESULTADO ====================

function showRoundResult(room) {

  showScreen("screen-round-result");

  const winner =
    Object.values(room.players || {})
    .find(p => p.id === room.roundWinner);

  document.getElementById(
    "round-winner-text"
  ).textContent = winner
    ? `¡${winner.name} ganó la ronda!`
    : (needsTimer(room.mode) ? "⏱ ¡Se acabó el tiempo! Nadie acertó" : "Ronda terminada");

  document.getElementById(
    "correct-word"
  ).textContent =
    room.currentWord;

  const nextBtn = document.getElementById("next-round-btn");

  if (nextBtn) {
    if (isHost) {
      nextBtn.classList.remove("hidden");

      if (room.currentRound >= room.totalRounds) {
        nextBtn.textContent = "Ver resultado final";
      } else {
        nextBtn.textContent = "Siguiente ronda";
      }

    } else {
      nextBtn.classList.add("hidden");
    }
  }
}

// ==================== SIGUIENTE RONDA ====================

async function nextRound() {

  if (!isHost) return;

  const snapshot = await get(roomRef);

  const room = snapshot.val();

  if (!room) return;

  const nextRoundNumber = room.currentRound + 1;

  if (nextRoundNumber > room.totalRounds) {
    await update(roomRef, {
      status: "gameOver",
      roundStatus: "finished"
    });

    return;
  }

  const { word: newWord, length } = getWordForRoom(room.theme, room.difficulty);

  const updates = {
    currentRound: nextRoundNumber,
    currentWord: newWord,
    currentWordLength: length,
    roundWinner: null,
    roundStatus: "playing",
    status: "playing",
    roundDeadline: computeRoundDeadline(room)
  };

  Object.keys(room.players || {}).forEach(pid => {
    updates[`players/${pid}/attempts`] = [];
  });

  await update(roomRef, updates);
}

// ==================== FINAL ====================

function showFinalScreen(room) {

  showScreen("screen-final");

  const ranking =
    document.getElementById(
      "final-ranking"
    );

  ranking.innerHTML = "";

  const players =
    Object.values(room.players || {})
    .sort((a, b) => b.score - a.score);

  players.forEach((p, index) => {

    const el =
      document.createElement("p");

    const tag = p.eliminated ? " ❌ eliminado" : "";

    el.textContent =
      `${index + 1}. ${p.name} - ${p.score}${tag}`;

    ranking.appendChild(el);
  });
}

// ==================== REINICIAR ====================

function restartGame() {
  clearSession();
  location.reload();
}

function goToStart() {
  clearSession();
  location.reload();
}

// ==================== ENTER ====================

document.addEventListener(
  "DOMContentLoaded",
  () => {

    populateCreateForm();
    attemptReconnect();

    window.addEventListener("resize", handleBoardResize);
    window.addEventListener("orientationchange", handleBoardResize);

    const input =
      document.getElementById(
        "guess-input"
      );

    if (input) {

      input.addEventListener(
        "keypress",
        e => {

          if (e.key === "Enter") {
            submitGuess();
          }
        }
      );
    }
  }
);

// ==================== HACER FUNCIONES GLOBALES ====================

window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.startGame = startGame;
window.submitGuess = submitGuess;
window.nextRound = nextRound;
window.restartGame = restartGame;
window.goToStart = goToStart;
window.copyRoomCode = copyRoomCode;
window.leaveRoom = leaveRoom;

window.goToCreate = goToCreate;
window.goToPublicRooms = goToPublicRooms;
window.goToJoinByCode = goToJoinByCode;
window.backToStart = backToStart;
window.backToStartFromCreate = backToStartFromCreate;
window.toggleVisibility = toggleVisibility;