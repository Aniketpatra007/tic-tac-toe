import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  runTransaction,
  onValue,
  onDisconnect,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const PLAYER_STORAGE_PREFIX = "ttt_player_";
const LOCAL_ROOM_PREFIX = "ttt_room_";
const LOCAL_BROADCAST_CHANNEL = "ttt_room_updates";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const state = {
  roomId: null,
  localPlayerId: null,
  localName: "",
  localSymbol: null,
  roomUnsubscribe: null,
  backendMode: "firebase",
  channel: null,
};

const ui = {
  lobbySection: document.getElementById("lobbySection"),
  gameSection: document.getElementById("gameSection"),
  playerNameInput: document.getElementById("playerNameInput"),
  roomIdInput: document.getElementById("roomIdInput"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  lobbyMessage: document.getElementById("lobbyMessage"),
  roomIdBadge: document.getElementById("roomIdBadge"),
  copyRoomBtn: document.getElementById("copyRoomBtn"),
  leaveRoomBtn: document.getElementById("leaveRoomBtn"),
  waitingOverlay: document.getElementById("waitingOverlay"),
  playerXName: document.getElementById("playerXName"),
  playerOName: document.getElementById("playerOName"),
  scoreX: document.getElementById("scoreX"),
  scoreO: document.getElementById("scoreO"),
  playerXChip: document.getElementById("playerXChip"),
  playerOChip: document.getElementById("playerOChip"),
  turnText: document.getElementById("turnText"),
  resultText: document.getElementById("resultText"),
  restartBtn: document.getElementById("restartBtn"),
  cells: Array.from(document.querySelectorAll(".cell")),
};

function isFirebaseConfigured() {
  return !Object.values(firebaseConfig).some((value) =>
    String(value).includes("YOUR_"),
  );
}

function showLobby(message = "") {
  ui.lobbySection.classList.add("active");
  ui.gameSection.classList.remove("active");
  ui.lobbyMessage.textContent = message;
}

function showGame() {
  ui.lobbySection.classList.remove("active");
  ui.gameSection.classList.add("active");
}

function sanitizeName(name) {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 20) || "Player";
}

function makePlayerId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `p_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function makeRoomId(mode) {
  const prefix = mode === "local" ? "L" : "F";
  const body = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}${body}`;
}

function resolveBackendMode(roomId, modeHint = null) {
  if (modeHint === "local" || modeHint === "firebase") return modeHint;

  if (roomId.startsWith("L")) return "local";
  if (roomId.startsWith("F")) return "firebase";

  return state.backendMode;
}

function getRoomRef(roomId) {
  return ref(db, `rooms/${roomId}`);
}

function getPresenceRef(roomId, playerId) {
  return ref(db, `rooms/${roomId}/presence/${playerId}`);
}

function storageKey(roomId) {
  return `${PLAYER_STORAGE_PREFIX}${roomId}`;
}

function saveLocalIdentity(roomId, identity) {
  sessionStorage.setItem(storageKey(roomId), JSON.stringify(identity));
}

function loadLocalIdentity(roomId) {
  const raw = sessionStorage.getItem(storageKey(roomId));
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearLocalIdentity(roomId) {
  sessionStorage.removeItem(storageKey(roomId));
}

function localRoomKey(roomId) {
  return `${LOCAL_ROOM_PREFIX}${roomId}`;
}

function cloneRoom(roomData) {
  return roomData ? JSON.parse(JSON.stringify(roomData)) : roomData;
}

function readLocalRoom(roomId) {
  const raw = localStorage.getItem(localRoomKey(roomId));
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeLocalRoom(roomId, roomData) {
  if (roomData === null) {
    localStorage.removeItem(localRoomKey(roomId));
  } else {
    localStorage.setItem(localRoomKey(roomId), JSON.stringify(roomData));
  }

  if (state.channel) {
    state.channel.postMessage({ roomId, roomData });
  }
}

function mutateLocalRoom(roomId, mutator) {
  const current = readLocalRoom(roomId);
  const next = mutator(cloneRoom(current));

  if (typeof next === "undefined") {
    return { committed: false };
  }

  writeLocalRoom(roomId, next);
  return { committed: true, snapshot: next };
}

function subscribeLocalRoom(roomId, callback) {
  const key = localRoomKey(roomId);

  const emitCurrent = () => {
    callback(readLocalRoom(roomId));
  };

  const onStorage = (event) => {
    if (event.key === key) {
      emitCurrent();
    }
  };

  const onChannel = (event) => {
    if (event.data?.roomId === roomId) {
      emitCurrent();
    }
  };

  window.addEventListener("storage", onStorage);
  if (state.channel) {
    state.channel.addEventListener("message", onChannel);
  }

  emitCurrent();

  return () => {
    window.removeEventListener("storage", onStorage);
    if (state.channel) {
      state.channel.removeEventListener("message", onChannel);
    }
  };
}

function getResult(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }

  if (board.every((cell) => cell)) {
    return { winner: null, line: null, draw: true };
  }

  return { winner: null, line: null, draw: false };
}

function defaultRoomData(roomId, playerId, playerName) {
  return {
    roomId,
    createdAt: Date.now(),
    status: "waiting",
    board: ["", "", "", "", "", "", "", "", ""],
    currentPlayer: "X",
    result: {
      winner: "",
      draw: false,
      winningLine: [],
      message: "",
    },
    players: {
      [playerId]: {
        id: playerId,
        name: playerName,
        symbol: "X",
        joinedAt: Date.now(),
      },
    },
    scoreboard: {
      X: 0,
      O: 0,
    },
  };
}

function getPlayerBySymbol(players, symbol) {
  return Object.values(players || {}).find(
    (player) => player.symbol === symbol,
  );
}

function deriveLocalSymbol(players) {
  const me = players?.[state.localPlayerId];
  return me?.symbol || null;
}

function isMyTurn(roomData) {
  return roomData.currentPlayer === state.localSymbol;
}

function canPlay(roomData) {
  if (!state.localSymbol) return false;
  if (roomData.status !== "playing") return false;
  if (roomData.result?.winner || roomData.result?.draw) return false;
  return isMyTurn(roomData);
}

function setLocalRoomUrl(roomId, mode = state.backendMode) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  url.searchParams.set("mode", mode);
  window.history.replaceState({}, "", url);
}

function clearLocalRoomUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  url.searchParams.delete("mode");
  window.history.replaceState({}, "", url);
}

function updateBoardUI(roomData) {
  const board = roomData.board || [];
  const winningLine = roomData.result?.winningLine || [];

  ui.cells.forEach((cell, index) => {
    const value = board[index] || "";
    cell.textContent = value;
    cell.classList.remove("x", "o", "win");
    if (value === "X") cell.classList.add("x");
    if (value === "O") cell.classList.add("o");
    if (winningLine.includes(index)) cell.classList.add("win");
  });
}

function updateTurnAndResultUI(roomData) {
  const xPlayer = getPlayerBySymbol(roomData.players, "X");
  const oPlayer = getPlayerBySymbol(roomData.players, "O");

  ui.playerXName.textContent = xPlayer?.name || "Player X";
  ui.playerOName.textContent = oPlayer?.name || "Player O";
  ui.scoreX.textContent = String(roomData.scoreboard?.X ?? 0);
  ui.scoreO.textContent = String(roomData.scoreboard?.O ?? 0);

  ui.playerXChip.classList.toggle(
    "active-turn",
    roomData.currentPlayer === "X",
  );
  ui.playerOChip.classList.toggle(
    "active-turn",
    roomData.currentPlayer === "O",
  );

  if (roomData.status === "waiting") {
    ui.turnText.textContent = "Waiting for opponent...";
    ui.resultText.textContent = "";
    return;
  }

  if (roomData.result?.winner) {
    const winnerName =
      roomData.result.winner === "X" ? xPlayer?.name : oPlayer?.name;
    ui.turnText.textContent = "Round complete";
    ui.resultText.textContent = `${winnerName || roomData.result.winner} wins!`;
  } else if (roomData.result?.draw) {
    ui.turnText.textContent = "Round complete";
    ui.resultText.textContent = "It is a draw.";
  } else {
    const currentName =
      roomData.currentPlayer === "X" ? xPlayer?.name : oPlayer?.name;
    const myTag = isMyTurn(roomData) ? " (Your turn)" : "";
    ui.turnText.textContent = `Turn: ${roomData.currentPlayer} - ${currentName || "Player"}${myTag}`;
    ui.resultText.textContent = "";
  }
}

function updateWaitingUI(roomData) {
  const playerCount = Object.keys(roomData.players || {}).length;
  const waiting = playerCount < 2 || roomData.status === "waiting";
  ui.waitingOverlay.classList.toggle("active", waiting);
  ui.restartBtn.disabled = waiting;
}

function updateActionButtons(roomData) {
  const playable = canPlay(roomData);
  const roundOver = Boolean(roomData.result?.winner || roomData.result?.draw);

  ui.cells.forEach((cell, index) => {
    const filled = Boolean(roomData.board[index]);
    cell.disabled = !playable || filled || roundOver;
  });

  ui.restartBtn.disabled = roomData.status !== "playing";
}

function renderRoom(roomData) {
  state.localSymbol = deriveLocalSymbol(roomData.players);
  ui.roomIdBadge.textContent = state.roomId;
  updateBoardUI(roomData);
  updateTurnAndResultUI(roomData);
  updateWaitingUI(roomData);
  updateActionButtons(roomData);
}

function detachRoomListener() {
  if (typeof state.roomUnsubscribe === "function") {
    state.roomUnsubscribe();
    state.roomUnsubscribe = null;
  }
}

function attachRoomListener() {
  detachRoomListener();

  if (state.backendMode === "firebase") {
    const roomRef = getRoomRef(state.roomId);

    state.roomUnsubscribe = onValue(roomRef, (snapshot) => {
      if (!snapshot.exists()) {
        showLobby("Room no longer exists.");
        clearLocalRoomUrl();
        detachRoomListener();
        return;
      }

      renderRoom(snapshot.val());
    });
    return;
  }

  state.roomUnsubscribe = subscribeLocalRoom(state.roomId, (roomData) => {
    if (!roomData) {
      showLobby("Room no longer exists.");
      clearLocalRoomUrl();
      detachRoomListener();
      return;
    }

    renderRoom(roomData);
  });
}

function attachPresence() {
  if (state.backendMode !== "firebase") return;

  const presenceRef = getPresenceRef(state.roomId, state.localPlayerId);
  set(presenceRef, { online: true, at: Date.now(), name: state.localName });
  onDisconnect(presenceRef).remove();
}

async function setRoom(roomId, roomData, mode = state.backendMode) {
  if (mode === "firebase") {
    await set(getRoomRef(roomId), roomData);
    return;
  }

  writeLocalRoom(roomId, roomData);
}

async function mutateRoom(roomId, mutator, mode = state.backendMode) {
  if (mode === "firebase") {
    return runTransaction(getRoomRef(roomId), mutator);
  }

  return mutateLocalRoom(roomId, mutator);
}

async function createRoom() {
  const localName = sanitizeName(ui.playerNameInput.value);
  const roomMode = state.backendMode;
  const roomId = makeRoomId(roomMode);
  const playerId = makePlayerId();

  await setRoom(roomId, defaultRoomData(roomId, playerId, localName), roomMode);

  state.roomId = roomId;
  state.localPlayerId = playerId;
  state.localName = localName;
  state.backendMode = roomMode;

  saveLocalIdentity(roomId, { playerId, name: localName });
  setLocalRoomUrl(roomId, roomMode);
  ui.roomIdInput.value = roomId;
  attachRoomListener();
  attachPresence();
  showGame();
}

async function joinRoom(roomIdRaw, modeHint = null) {
  const roomId = roomIdRaw.trim().toUpperCase();
  const typedName = sanitizeName(ui.playerNameInput.value);
  const storedIdentity = loadLocalIdentity(roomId);
  const localName = storedIdentity?.name || typedName;
  const preferredId = storedIdentity?.playerId || null;
  const preferredMode = resolveBackendMode(roomId, modeHint);

  if (!roomId) {
    showLobby("Enter a room code.");
    return;
  }

  const explicitMode =
    roomId.startsWith("L") || roomId.startsWith("F") || modeHint;
  const fallbackMode = preferredMode === "local" ? "firebase" : "local";
  const modesToTry = explicitMode
    ? [preferredMode]
    : [preferredMode, fallbackMode];

  for (const joinMode of modesToTry) {
    if (joinMode === "firebase" && !isFirebaseConfigured()) {
      continue;
    }

    let joinOutcome = null;

    const txResult = await mutateRoom(
      roomId,
      (roomData) => {
        if (!roomData) {
          joinOutcome = { error: "not-found" };
          return roomData;
        }

        roomData.players = roomData.players || {};

        let existingEntry = null;
        if (preferredId && roomData.players[preferredId]) {
          existingEntry = [preferredId, roomData.players[preferredId]];
        }

        if (existingEntry) {
          const [id, player] = existingEntry;
          player.name = localName;
          joinOutcome = { playerId: id };
          return roomData;
        }

        if (Object.keys(roomData.players).length >= 2) {
          joinOutcome = { error: "full" };
          return roomData;
        }

        const playerId = preferredId || makePlayerId();
        const symbol = Object.values(roomData.players).some(
          (player) => player.symbol === "X",
        )
          ? "O"
          : "X";

        roomData.players[playerId] = {
          id: playerId,
          name: localName,
          symbol,
          joinedAt: Date.now(),
        };

        roomData.status =
          Object.keys(roomData.players).length === 2 ? "playing" : "waiting";
        joinOutcome = { playerId };
        return roomData;
      },
      joinMode,
    );

    if (!txResult.committed || !joinOutcome) {
      continue;
    }

    if (joinOutcome.error === "not-found") {
      continue;
    }

    if (joinOutcome.error === "full") {
      showLobby("Room is full.");
      return;
    }

    state.roomId = roomId;
    state.localPlayerId = joinOutcome.playerId;
    state.localName = localName;
    state.backendMode = joinMode;

    saveLocalIdentity(roomId, {
      playerId: state.localPlayerId,
      name: localName,
    });
    setLocalRoomUrl(roomId, joinMode);
    ui.roomIdInput.value = roomId;
    attachRoomListener();
    attachPresence();
    showGame();
    return;
  }

  if (!isFirebaseConfigured() && preferredMode === "firebase") {
    showLobby(
      "This room appears to use Firebase, but Firebase config is not set.",
    );
    return;
  }

  showLobby(
    "Room not found. If this is a local room, open it in the same browser profile as the creator.",
  );
}

async function makeMove(cellIndex) {
  await mutateRoom(state.roomId, (roomData) => {
    if (!roomData) return roomData;

    const localPlayer = roomData.players?.[state.localPlayerId];
    if (!localPlayer) return roomData;

    const alreadyFinished = roomData.result?.winner || roomData.result?.draw;
    const notPlaying = roomData.status !== "playing";
    const notYourTurn = roomData.currentPlayer !== localPlayer.symbol;
    const filled = Boolean(roomData.board?.[cellIndex]);

    if (alreadyFinished || notPlaying || notYourTurn || filled) {
      return roomData;
    }

    roomData.board[cellIndex] = localPlayer.symbol;

    const analysis = getResult(roomData.board);
    if (analysis.winner) {
      roomData.result = {
        winner: analysis.winner,
        draw: false,
        winningLine: analysis.line,
        message: `${analysis.winner} wins`,
      };
      roomData.scoreboard[analysis.winner] =
        (roomData.scoreboard[analysis.winner] || 0) + 1;
    } else if (analysis.draw) {
      roomData.result = {
        winner: "",
        draw: true,
        winningLine: [],
        message: "Draw",
      };
    } else {
      roomData.currentPlayer = roomData.currentPlayer === "X" ? "O" : "X";
      roomData.result = {
        winner: "",
        draw: false,
        winningLine: [],
        message: "",
      };
    }

    return roomData;
  });
}

async function restartRound() {
  await mutateRoom(state.roomId, (roomData) => {
    if (!roomData) return roomData;
    if (roomData.status !== "playing") return roomData;

    roomData.board = ["", "", "", "", "", "", "", "", ""];
    roomData.currentPlayer = "X";
    roomData.result = {
      winner: "",
      draw: false,
      winningLine: [],
      message: "",
    };

    return roomData;
  });
}

async function leaveRoom() {
  if (!state.roomId || !state.localPlayerId) return;

  const currentRoomId = state.roomId;

  await mutateRoom(state.roomId, (roomData) => {
    if (!roomData) return roomData;
    if (!roomData.players) return roomData;

    delete roomData.players[state.localPlayerId];

    const count = Object.keys(roomData.players).length;
    if (count <= 0) {
      return null;
    }

    roomData.status = count === 2 ? "playing" : "waiting";
    roomData.board = ["", "", "", "", "", "", "", "", ""];
    roomData.currentPlayer = "X";
    roomData.result = {
      winner: "",
      draw: false,
      winningLine: [],
      message: "",
    };

    return roomData;
  });

  detachRoomListener();
  state.roomId = null;
  state.localPlayerId = null;
  state.localName = "";
  state.localSymbol = null;
  clearLocalIdentity(currentRoomId);
  clearLocalRoomUrl();
  showLobby(`You left the room. Mode: ${state.backendMode.toUpperCase()}`);
}

function copyRoomLink() {
  if (!state.roomId) return;

  const link = `${window.location.origin}${window.location.pathname}?room=${state.roomId}&mode=${state.backendMode}`;
  navigator.clipboard.writeText(link).then(() => {
    ui.resultText.textContent = "Room link copied.";
  });
}

function setupEvents() {
  ui.createRoomBtn.addEventListener("click", () => {
    createRoom().catch((error) => {
      console.error(error);
      showLobby("Failed to create room.");
    });
  });

  ui.joinRoomBtn.addEventListener("click", () => {
    joinRoom(ui.roomIdInput.value).catch((error) => {
      console.error(error);
      showLobby("Failed to join room.");
    });
  });

  ui.restartBtn.addEventListener("click", () => {
    restartRound().catch((error) => console.error(error));
  });

  ui.leaveRoomBtn.addEventListener("click", () => {
    leaveRoom().catch((error) => console.error(error));
  });

  ui.copyRoomBtn.addEventListener("click", copyRoomLink);

  ui.cells.forEach((cell) => {
    cell.addEventListener("click", () => {
      const index = Number(cell.dataset.index);
      makeMove(index).catch((error) => console.error(error));
    });
  });
}

async function restoreRoomFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  const mode = params.get("mode");

  if (!room) {
    const modeMessage =
      state.backendMode === "local"
        ? "Local Mode active. Create a room and open the link in another tab/browser window."
        : "Create a room to get a code.";
    showLobby(modeMessage);
    return;
  }

  const roomId = room.trim().toUpperCase();
  ui.roomIdInput.value = roomId;

  const storedIdentity = loadLocalIdentity(roomId);
  if (storedIdentity?.name) {
    ui.playerNameInput.value = storedIdentity.name;
    try {
      await joinRoom(roomId, mode);
      return;
    } catch (error) {
      console.error(error);
    }
  }

  showLobby("Room found in URL. Enter name and click Join Room.");
}

function initMode() {
  if (!isFirebaseConfigured()) {
    state.backendMode = "local";
  }

  if (typeof window.BroadcastChannel === "function") {
    state.channel = new BroadcastChannel(LOCAL_BROADCAST_CHANNEL);
  }

  if (state.backendMode === "local") {
    showLobby(
      "Local Mode active (Firebase not configured). Create Room to generate code.",
    );
  }
}

initMode();
setupEvents();
restoreRoomFromUrl();
