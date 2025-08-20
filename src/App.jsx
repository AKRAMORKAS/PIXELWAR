import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, push, runTransaction } from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAWjienwezNfIafxbSGGaZ9Aefo8n-_X3U",
  authDomain: "warpixel-5d49a.firebaseapp.com",
  databaseURL: "https://warpixel-5d49a-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "warpixel-5d49a",
  storageBucket: "warpixel-5d49a.appspot.com",
  messagingSenderId: "178465479901",
  appId: "1:178465479901:web:533caafe0b021406eb8f34",
  measurementId: "G-E4WJQ4WSVZ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const database = getDatabase(app);
const auth = getAuth(app);

/**
 * --- Константы карты ---
 */
const WIDTH = 213;
const HEIGHT = 128;
const PIXEL_SIZE = 6;

/**
 * Карта: слева 14 колонок — игрок (1), справа 14 — соперник (2), середина — нейтраль (0)
 */
function generateMap() {
  const map = Array.from({ length: HEIGHT }, () =>
    Array.from({ length: WIDTH }, (_, x) => ({ id: x < 14 ? 1 : x > WIDTH - 15 ? 2 : 0, fort: 0, resource: false, building: 'none' }))
  );

  // Изначальные бункеры для красной команды (игрок 2)
  addBunker(map, WIDTH - 20, 20, 2);
  addBunker(map, WIDTH - 20, Math.floor(HEIGHT / 2), 2);
  addBunker(map, WIDTH - 20, HEIGHT - 20, 2);

  // Добавляем ресурсные клетки в нейтральной зоне
  const resourceCount = 20;
  for (let i = 0; i < resourceCount; i++) {
    let placed = false;
    while (!placed) {
      const x = Math.floor(Math.random() * (WIDTH - 29)) + 14; // 14 to WIDTH-15
      const y = Math.floor(Math.random() * HEIGHT);
      if (!map[y][x].resource) {
        map[y][x].resource = true;
        placed = true;
      }
    }
  }

  return map;
}

/**
 * Функция для добавления бункера (увеличивает fort в радиусе 1 для 3x3)
 */
function addBunker(map, cx, cy, playerId) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (
        x >= 0 &&
        x < WIDTH &&
        y >= 0 &&
        y < HEIGHT &&
        Math.max(Math.abs(dx), Math.abs(dy)) <= 1 &&
        map[y][x].id === playerId
      ) {
        map[y][x].fort += 1;
      }
    }
  }
}

/**
 * Функция для добавления стены (устанавливает building='wall' и fort=3 на одной клетке)
 */
function addWall(map, x, y, playerId) {
  if (map[y][x].id === playerId && map[y][x].building === 'none') {
    map[y][x].building = 'wall';
    map[y][x].fort = 3;
  }
}

/**
 * Функция для добавления фабрики (устанавливает building='factory' на одной клетке)
 */
function addFactory(map, x, y, playerId) {
  if (map[y][x].id === playerId && map[y][x].building === 'none') {
    map[y][x].building = 'factory';
  }
}

/**
 * Является ли клетка «пограничной» для клика (4-соседство)
 */
function isBorder(map, x, y, playerId) {
  if (map[y][x].id === playerId) return false;
  const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  return dirs.some(([dx, dy]) => {
    const nx = x + dx,
      ny = y + dy;
    return nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT && map[ny][nx].id === playerId;
  });
}

/**
 * Автозахват анклавов после окраски (любая замкнутая область 0/вражеских — становится нашей)
 */
function captureEnclaves(map, playerId) {
  const visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
  const newMap = map.map(row => row.map(cell => ({ ...cell })));
  const targetIds = playerId === 1 ? [0, 2] : [0, 1];

  function bfs(sx, sy) {
    const queue = [[sx, sy]];
    const area = [[sx, sy]];
    visited[sy][sx] = true;
    let isEnclave = true;

    while (queue.length) {
      const [x, y] = queue.pop();
      for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= HEIGHT) {
          isEnclave = false;
          continue;
        }
        if (!visited[ny][nx] && targetIds.includes(map[ny][nx].id)) {
          visited[ny][nx] = true;
          queue.push([nx, ny]);
          area.push([nx, ny]);
        }
        if (!targetIds.includes(map[ny][nx].id) && map[ny][nx].id !== playerId) {
          isEnclave = false;
        }
      }
    }
    return isEnclave ? area : [];
  }

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (!visited[y][x] && targetIds.includes(map[y][x].id)) {
        const area = bfs(x, y);
        if (area.length) {
          for (const [ax, ay] of area) {
            newMap[ay][ax].id = playerId;
            newMap[ay][ax].fort = 0;
            // Building remains, e.g., factory transfers to new owner
          }
        }
      }
    }
  }
  return newMap;
}

/**
 * Подсчёт клеток для статистики «Война»
 */
function countCells(m) {
  let p1 = 0,
    p2 = 0,
    neutral = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (m[y][x].id === 1) p1++;
      else if (m[y][x].id === 2) p2++;
      else neutral++;
    }
  }
  return { p1, p2, neutral, total: WIDTH * HEIGHT };
}

/**
 * Подсчёт ресурсных клеток для команды
 */
function countResources(map, playerId) {
  let count = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (map[y][x].id === playerId && map[y][x].resource) count++;
    }
  }
  return count;
}

/**
 * Подсчёт фабрик для команды
 */
function countFactories(map, playerId) {
  let count = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (map[y][x].id === playerId && map[y][x].building === 'factory') count++;
    }
  }
  return count;
}

/**
 * --- Цвета ---
 */
const colors = {
  0: '#222',
  1: '#2196f3', // синий — игрок
  2: '#f44336', // красный — соперник
  border: '#ffe259', // жёлтый — можно захватить
  borderDisabled: '#888' // серый — во время кулдауна
};

/**
 * Функция для затемнения цвета
 */
function darken(hex, factor = 0.7) {
  const r = Math.floor(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.floor(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.floor(parseInt(hex.slice(5, 7), 16) * factor);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * --- Вкладки ---
 */
const TABS = [
  { key: 'work', label: 'Работа' },
  { key: 'war', label: 'Война' },
  { key: 'politics', label: 'Политика' },
  { key: 'chat', label: 'Чат' }
];

/**
 * Константы для улучшений
 */
const BUNKER_COST = 5000;
const WALL_COST = 3500;
const FACTORY_COST = 2500;
const BANK_UPGRADE_BASE_COST = 1000;
const WORK_UPGRADE_BASE_COST = 2000;
const BANK_RATE_STEP = 0.0001; // +0.01%
const BANK_MAX_RATE = 0.05; // 5%
const ARTILLERY_COST = 5000;
const AI_WORK_COST = 20000;
const AI_WORK_MAINTENANCE = 200; // per minute
const CAPTURE_NEUTRAL_COST = 50;
const CAPTURE_ENEMY_COST = 100;
const FACTORY_INCOME = 20; // per minute per factory
const RESOURCE_INCOME = 500; // per minute per resource

// Новые константы для улучшений в войне
const CAPTURE_SIZE_UPGRADE_COST = 5000; // Стоимость улучшения размера захвата
const CD_REDUCTION_UPGRADE_COST = 3000; // Стоимость уменьшения КД
const MAX_CAPTURE_SIZE_LEVEL = 3; // Макс уровень: 1->2->3->4 пикселя
const MAX_CD_REDUCTION_LEVEL = 5; // Макс уровень: уменьшает КД на 1 сек за уровень, мин 5 сек

function App() {
  const playerId = 1;
  const [user, setUser] = useState(null);
  const [map, setMap] = useState(generateMap());
  const prevMapRef = useRef(null);
  const [cooldown, setCooldown] = useState(false);
  const [placingBunker, setPlacingBunker] = useState(false);
  const [placingArtillery, setPlacingArtillery] = useState(false);
  const [placingWall, setPlacingWall] = useState(false);
  const [placingFactory, setPlacingFactory] = useState(false);

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(TABS[0].key);

  const [balance, setBalance] = useState(0);
  const [workLevel, setWorkLevel] = useState(1);
  const [workCost, setWorkCost] = useState(10);
  const [workCooldown, setWorkCooldown] = useState(false);
  const [aiWorkEnabled, setAiWorkEnabled] = useState(false);

  const [blueTreasury, setBlueTreasury] = useState(10000);
  const [redTreasury, setRedTreasury] = useState(10000);

  const [bank, setBank] = useState(0);
  const [lastWithdraw, setLastWithdraw] = useState(0);
  const [depositInput, setDepositInput] = useState('');
  const [withdrawInput, setWithdrawInput] = useState('');
  const [donateInput, setDonateInput] = useState('');

  const [globalWorkBonus, setGlobalWorkBonus] = useState(0);
  const [bankRate, setBankRate] = useState(0.0001);
  const [bankUpgradeLevel, setBankUpgradeLevel] = useState(0);
  const [workUpgradeLevel, setWorkUpgradeLevel] = useState(0);

  const [president, setPresident] = useState('');
  const [presidencyEnd, setPresidencyEnd] = useState(0);

  const [username, setUsername] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [votes, setVotes] = useState({});
  const [voted, setVoted] = useState(false);

  const [now, setNow] = useState(Date.now());
  const [votingEnd, setVotingEnd] = useState(0);

  const initialPlayerCellsRef = useRef(14 * HEIGHT);

  const [playerLosses, setPlayerLosses] = useState(0);

  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');

  const [botCooldownEnd, setBotCooldownEnd] = useState(0);
  const [lastIncomeTimeBlue, setLastIncomeTimeBlue] = useState(Date.now());
  const [lastIncomeTimeRed, setLastIncomeTimeRed] = useState(Date.now());

  const [hoverX, setHoverX] = useState(-1);
  const [hoverY, setHoverY] = useState(-1);

  const [animations, setAnimations] = useState([]);

  const [captureSizeLevel, setCaptureSizeLevel] = useState(0); // 0: 1 пиксель, 1: 2, 2: 3, 3: 4
  const [cdReductionLevel, setCdReductionLevel] = useState(0); // Уменьшает КД на 1 сек за уровень

  // Аутентификация
  useEffect(() => {
    signInAnonymously(auth)
      .then((userCredential) => {
        setUser(userCredential.user);
      })
      .catch((error) => {
        console.error("Authentication error:", error);
      });
  }, []);

  // Синхронизация shared states
  useEffect(() => {
    if (!user) return;

    const mapRef = ref(database, 'map');
    onValue(mapRef, (snap) => {
      const val = snap.val();
      if (val) setMap(val);
      else set(ref(database, 'map'), generateMap());
    });

    const blueTreasuryRef = ref(database, 'blueTreasury');
    onValue(blueTreasuryRef, (snap) => {
      const val = snap.val();
      setBlueTreasury(val !== null ? val : 10000);
    });

    const redTreasuryRef = ref(database, 'redTreasury');
    onValue(redTreasuryRef, (snap) => {
      const val = snap.val();
      setRedTreasury(val !== null ? val : 10000);
    });

    const globalWorkBonusRef = ref(database, 'globalWorkBonus');
    onValue(globalWorkBonusRef, (snap) => setGlobalWorkBonus(snap.val() || 0));

    const bankRateRef = ref(database, 'bankRate');
    onValue(bankRateRef, (snap) => setBankRate(snap.val() || 0.0001));

    const bankUpgradeLevelRef = ref(database, 'bankUpgradeLevel');
    onValue(bankUpgradeLevelRef, (snap) => setBankUpgradeLevel(snap.val() || 0));

    const workUpgradeLevelRef = ref(database, 'workUpgradeLevel');
    onValue(workUpgradeLevelRef, (snap) => setWorkUpgradeLevel(snap.val() || 0));

    const presidentRef = ref(database, 'president');
    onValue(presidentRef, (snap) => setPresident(snap.val() || ''));

    const presidencyEndRef = ref(database, 'presidencyEnd');
    onValue(presidencyEndRef, (snap) => setPresidencyEnd(snap.val() || 0));

    const candidatesRef = ref(database, 'candidates');
    onValue(candidatesRef, (snap) => setCandidates(snap.val() || []));

    const votesRef = ref(database, 'votes');
    onValue(votesRef, (snap) => setVotes(snap.val() || {}));

    const votingEndRef = ref(database, 'votingEnd');
    onValue(votingEndRef, (snap) => setVotingEnd(snap.val() || 0));

    const messagesRef = ref(database, 'messages');
    onValue(messagesRef, (snap) => {
      const val = snap.val();
      setMessages(val ? Object.values(val) : []);
    });

    const botCooldownEndRef = ref(database, 'botCooldownEnd');
    onValue(botCooldownEndRef, (snap) => setBotCooldownEnd(snap.val() || 0));

    const lastIncomeTimeBlueRef = ref(database, 'lastIncomeTimeBlue');
    onValue(lastIncomeTimeBlueRef, (snap) => setLastIncomeTimeBlue(snap.val() || Date.now()));

    const lastIncomeTimeRedRef = ref(database, 'lastIncomeTimeRed');
    onValue(lastIncomeTimeRedRef, (snap) => setLastIncomeTimeRed(snap.val() || Date.now()));

  }, [user]);

  // Синхронизация personal states
  useEffect(() => {
    if (!user) return;

    const balanceRef = ref(database, `users/${user.uid}/balance`);
    onValue(balanceRef, (snap) => setBalance(snap.val() || 0));

    const bankRef = ref(database, `users/${user.uid}/bank`);
    onValue(bankRef, (snap) => setBank(snap.val() || 0));

    const lastWithdrawRef = ref(database, `users/${user.uid}/lastWithdraw`);
    onValue(lastWithdrawRef, (snap) => setLastWithdraw(snap.val() || 0));

    const usernameRef = ref(database, `users/${user.uid}/username`);
    onValue(usernameRef, (snap) => setUsername(snap.val() || ''));

    const votedRef = ref(database, `users/${user.uid}/voted`);
    onValue(votedRef, (snap) => setVoted(snap.val() || false));

    const workLevelRef = ref(database, `users/${user.uid}/workLevel`);
    onValue(workLevelRef, (snap) => setWorkLevel(snap.val() || 1));

    const workCostRef = ref(database, `users/${user.uid}/workCost`);
    onValue(workCostRef, (snap) => setWorkCost(snap.val() || 10));

    const playerLossesRef = ref(database, `users/${user.uid}/playerLosses`);
    onValue(playerLossesRef, (snap) => setPlayerLosses(snap.val() || 0));

    const aiWorkEnabledRef = ref(database, `users/${user.uid}/aiWorkEnabled`);
    onValue(aiWorkEnabledRef, (snap) => setAiWorkEnabled(snap.val() || false));

    const captureSizeLevelRef = ref(database, `users/${user.uid}/captureSizeLevel`);
    onValue(captureSizeLevelRef, (snap) => setCaptureSizeLevel(snap.val() || 0));

    const cdReductionLevelRef = ref(database, `users/${user.uid}/cdReductionLevel`);
    onValue(cdReductionLevelRef, (snap) => setCdReductionLevel(snap.val() || 0));

  }, [user]);

  // Блокируем прокрутку страницы
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  // Центрирование карты при первом рендере
  useEffect(() => {
    if (containerRef.current) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setOffset({
        x: (vw - WIDTH * PIXEL_SIZE * zoom) / 2,
        y: (vh - HEIGHT * PIXEL_SIZE * zoom) / 2
      });
    }
  }, []);

  // Тики секундных таймеров
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Автозавершение голосования и автоматическая отставка президента
  useEffect(() => {
    if (votingEnd > 0 && now >= votingEnd) {
      finishElection();
    }
    if (president && presidencyEnd > 0 && now >= presidencyEnd) {
      set(ref(database, 'president'), '');
      set(ref(database, 'presidencyEnd'), 0);
    }
  }, [now, votingEnd, president, presidencyEnd]);

  // Рисуем карту на canvas
  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.setTransform(zoom, 0, 0, zoom, offset.x, offset.y);

    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        let color = colors[map[y][x].id];
        if (isBorder(map, x, y, playerId)) {
          color = cooldown ? colors.borderDisabled : colors.border;
        }
        if (map[y][x].fort > 0) {
          color = darken(color);
        }
        if (map[y][x].building === 'wall') {
          color = darken(color, 0.5); // Темнее чем бункер
        }
        ctx.fillStyle = color;
        ctx.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);

        // Рисуем ресурсные клетки
        if (map[y][x].resource) {
          ctx.fillStyle = '#ffd700'; // gold
          ctx.beginPath();
          ctx.arc((x + 0.5) * PIXEL_SIZE, (y + 0.5) * PIXEL_SIZE, PIXEL_SIZE / 3, 0, 2 * Math.PI);
          ctx.fill();
        }

        // Рисуем значок фабрики
        if (map[y][x].building === 'factory') {
          ctx.fillStyle = '#808080'; // gray for factory icon
          ctx.fillRect(x * PIXEL_SIZE + PIXEL_SIZE / 4, y * PIXEL_SIZE + PIXEL_SIZE / 4, PIXEL_SIZE / 2, PIXEL_SIZE / 2);
        }
      }
    }

    // Подсветка для размещения
    if ((placingBunker || placingArtillery || placingWall || placingFactory) && hoverX >= 0 && hoverY >= 0) {
      let highlightColor = 'rgba(0,255,0,0.3)';
      if (placingArtillery) highlightColor = 'rgba(255,0,0,0.3)';
      if (placingWall) highlightColor = 'rgba(128,128,128,0.3)';
      if (placingFactory) highlightColor = 'rgba(0,0,255,0.3)';
      let valid = true;
      let area = [];
      if (placingBunker || placingArtillery) {
        area = Array.from({length: 3}, (_, dy) => Array.from({length: 3}, (_, dx) => [hoverX + dx - 1, hoverY + dy - 1])).flat();
      } else {
        area = [[hoverX, hoverY]];
      }
      for (const [nx, ny] of area) {
        if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= HEIGHT) {
          valid = false;
          break;
        }
        if ((placingBunker || placingWall || placingFactory) && map[ny][nx].id !== playerId) valid = false;
        if (placingArtillery && map[ny][nx].id !== (playerId === 1 ? 2 : 1)) valid = false;
        if ((placingWall || placingFactory) && map[ny][nx].building !== 'none') valid = false;
      }
      if (valid || placingArtillery) {
        ctx.fillStyle = highlightColor;
        for (const [nx, ny] of area) {
          if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT) {
            ctx.fillRect(nx * PIXEL_SIZE, ny * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
          }
        }
      }
    }

    // Улучшенные анимации вспышек (с пульсацией)
    const currentTime = Date.now();
    animations.forEach(anim => {
      const elapsed = currentTime - anim.time;
      if (elapsed < 1000) { // 1 sec animation
        const alpha = Math.sin((elapsed / 1000) * Math.PI) * 0.8; // pulse
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        if (anim.type === 'artillery' || anim.type === 'bunker') {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = anim.x + dx;
              const ny = anim.y + dy;
              if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT) {
                ctx.fillRect(nx * PIXEL_SIZE, ny * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
              }
            }
          }
        } else {
          ctx.fillRect(anim.x * PIXEL_SIZE, anim.y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
        }
      }
    });
    setAnimations(prev => prev.filter(anim => currentTime - anim.time < 1000));

  }, [map, zoom, offset, playerId, cooldown, placingBunker, placingArtillery, placingWall, placingFactory, hoverX, hoverY, animations]);

  // Детект изменений карты для анимаций
  useEffect(() => {
    if (prevMapRef.current) {
      const newAnimations = [];
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          if (map[y][x].id !== prevMapRef.current[y][x].id || map[y][x].fort !== prevMapRef.current[y][x].fort || map[y][x].building !== prevMapRef.current[y][x].building) {
            newAnimations.push({ x, y, type: 'capture', time: Date.now() });
          }
        }
      }
      if (newAnimations.length > 0) {
        setAnimations(prev => [...prev, ...newAnimations]);
      }
    }
    prevMapRef.current = map;
  }, [map]);

  // Проценты по депозиту каждые 5 сек
  useEffect(() => {
    const id = setInterval(() => {
      if (bank > 0) {
        runTransaction(ref(database, `users/${user.uid}/bank`), (currentBank) => {
          return +(currentBank * (1 + bankRate)).toFixed(4);
        });
      }
    }, 5000);
    return () => clearInterval(id);
  }, [bankRate, bank, user]);

  // Проверка конца игры
  useEffect(() => {
    const { p1, p2, total } = countCells(map);
    if (p1 / total > 0.9) {
      alert('Синяя команда победила! Игра начинается заново.');
    } else if (p2 / total > 0.9) {
      alert('Красная команда победила! Игра начинается заново.');
    }
  }, [map]);

  // Пассивный доход от ресурсов и фабрик
  useEffect(() => {
    const interval = setInterval(() => {
      // Для blue
      runTransaction(ref(database, 'lastIncomeTimeBlue'), (current) => {
        const periods = Math.floor((now - current) / 60000);
        if (periods > 0) {
          const resourceIncome = periods * countResources(map, 1) * RESOURCE_INCOME;
          const factoryIncome = periods * countFactories(map, 1) * FACTORY_INCOME;
          runTransaction(ref(database, 'blueTreasury'), (treas) => treas + resourceIncome + factoryIncome);
          return current + periods * 60000;
        }
        return current;
      });

      // Для red
      runTransaction(ref(database, 'lastIncomeTimeRed'), (current) => {
        const periods = Math.floor((now - current) / 60000);
        if (periods > 0) {
          const resourceIncome = periods * countResources(map, 2) * RESOURCE_INCOME;
          const factoryIncome = periods * countFactories(map, 2) * FACTORY_INCOME;
          runTransaction(ref(database, 'redTreasury'), (treas) => treas + resourceIncome + factoryIncome);
          return current + periods * 60000;
        }
        return current;
      });
    }, 10000); // check every 10s
    return () => clearInterval(interval);
  }, [now, map]);

  // Логика бота для красной команды
  useEffect(() => {
    const botInterval = setInterval(tryBotAction, 2000); // Увеличена активность
    return () => clearInterval(botInterval);
  }, [map, redTreasury, botCooldownEnd, now]);

  function tryBotAction() {
    if (now < botCooldownEnd) return;

    // Шанс на разные действия
    const action = Math.random();
    if (action < 0.6) { // 60% захват
      botCapture();
    } else if (action < 0.8) { // 20% бункер
      placeBotBunker();
    } else if (action < 0.9) { // 10% стена
      placeBotWall();
    } else { // 10% фабрика
      placeBotFactory();
    }
  }

  function botCapture() {
    // Найти пограничные клетки для 2
    const borders = [];
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (isBorder(map, x, y, 2)) {
          borders.push({x, y});
        }
      }
    }
    if (borders.length === 0) return;

    // Выбрать случайную
    const {x, y} = borders[Math.floor(Math.random() * borders.length)];

    // Определить стоимость
    const targetId = map[y][x].id;
    const cost = targetId === 0 ? CAPTURE_NEUTRAL_COST : CAPTURE_ENEMY_COST;

    if (redTreasury < cost) return;

    // Транзакция для кулдауна
    runTransaction(ref(database, 'botCooldownEnd'), (current) => {
      if (now >= current) {
        // Захват
        runTransaction(ref(database, 'map'), (currentMap) => {
          const newMap = currentMap.map(row => row.map(cell => ({ ...cell })));
          runTransaction(ref(database, 'redTreasury'), (treas) => treas - cost);
          if (newMap[y][x].fort > 0) {
            newMap[y][x].fort--;
          } else {
            newMap[y][x].id = 2;
            newMap[y][x].fort = 0;
          }
          const withEnclaves = captureEnclaves(newMap, 2);
          return withEnclaves;
        });
        return now + 2000;
      }
      return current;
    });
  }

  function placeBotBunker() {
    // Найти случайную позицию на своей территории
    const positions = [];
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = WIDTH - 28; x < WIDTH; x++) { // near right
        if (map[y][x].id === 2) {
          positions.push({x, y});
        }
      }
    }
    if (positions.length === 0) return;

    const {x, y} = positions[Math.floor(Math.random() * positions.length)];

    runTransaction(ref(database, 'redTreasury'), (treas) => {
      if (treas >= BUNKER_COST) {
        runTransaction(ref(database, 'map'), (currentMap) => {
          const newMap = currentMap.map(row => row.map(cell => ({ ...cell })));
          addBunker(newMap, x, y, 2);
          return newMap;
        });
        return treas - BUNKER_COST;
      }
      return treas;
    });
  }

  function placeBotWall() {
    const positions = [];
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = WIDTH - 28; x < WIDTH; x++) {
        if (map[y][x].id === 2 && map[y][x].building === 'none') {
          positions.push({x, y});
        }
      }
    }
    if (positions.length === 0) return;

    const {x, y} = positions[Math.floor(Math.random() * positions.length)];

    runTransaction(ref(database, 'redTreasury'), (treas) => {
      if (treas >= WALL_COST) {
        runTransaction(ref(database, 'map'), (currentMap) => {
          const newMap = currentMap.map(row => row.map(cell => ({ ...cell })));
          addWall(newMap, x, y, 2);
          return newMap;
        });
        return treas - WALL_COST;
      }
      return treas;
    });
  }

  function placeBotFactory() {
    const positions = [];
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = WIDTH - 28; x < WIDTH; x++) {
        if (map[y][x].id === 2 && map[y][x].building === 'none') {
          positions.push({x, y});
        }
      }
    }
    if (positions.length === 0) return;

    const {x, y} = positions[Math.floor(Math.random() * positions.length)];

    runTransaction(ref(database, 'redTreasury'), (treas) => {
      if (treas >= FACTORY_COST) {
        runTransaction(ref(database, 'map'), (currentMap) => {
          const newMap = currentMap.map(row => row.map(cell => ({ ...cell })));
          addFactory(newMap, x, y, 2);
          return newMap;
        });
        return treas - FACTORY_COST;
      }
      return treas;
    });
  }

  // AI work auto
  useEffect(() => {
    if (aiWorkEnabled) {
      const workId = setInterval(handleWork, 3000);
      return () => clearInterval(workId);
    }
  }, [aiWorkEnabled, workCooldown]);

  // AI maintenance deduct
  useEffect(() => {
    if (aiWorkEnabled) {
      const deductId = setInterval(() => {
        runTransaction(ref(database, `users/${user.uid}/balance`), (currentBalance) => {
          if (currentBalance >= AI_WORK_MAINTENANCE) {
            return currentBalance - AI_WORK_MAINTENANCE;
          } else {
            runTransaction(ref(database, `users/${user.uid}/aiWorkEnabled`), () => false);
            return currentBalance;
          }
        });
      }, 60000);
      return () => clearInterval(deductId);
    }
  }, [aiWorkEnabled, user]);

  function handleCanvasClick(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = (e.clientX - rect.left - offset.x) / zoom;
    const cy = (e.clientY - rect.top - offset.y) / zoom;
    const x = Math.floor(cx / PIXEL_SIZE);
    const y = Math.floor(cy / PIXEL_SIZE);

    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;

    if (placingBunker) {
      let valid = true;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= HEIGHT || map[ny][nx].id !== playerId) {
            valid = false;
            break;
          }
        }
        if (!valid) break;
      }
      if (valid) {
        runTransaction(ref(database, 'blueTreasury'), (treas) => {
          if (treas < BUNKER_COST) return treas;
          runTransaction(ref(database, 'map'), (currentMap) => {
            const newMap = currentMap.map(row => row.map(cell => ({ ...cell })));
            addBunker(newMap, x, y, playerId);
            setAnimations(prev => [...prev, {x, y, type: 'bunker', time: Date.now()}]);
            return newMap;
          });
          return treas - BUNKER_COST;
        });
        setPlacingBunker(false);
      } else {
        alert('Можно строить только на своей территории');
      }
      return;
    }

    if (placingWall) {
      if (map[y][x].id === playerId && map[y][x].building === 'none') {
        runTransaction(ref(database, 'blueTreasury'), (treas) => {
          if (treas < WALL_COST) return treas;
          runTransaction(ref(database, 'map'), (currentMap) => {
            const newMap = currentMap.map(row => row.map(cell => ({ ...cell })));
            addWall(newMap, x, y, playerId);
            setAnimations(prev => [...prev, {x, y, type: 'capture', time: Date.now()}]);
            return newMap;
          });
          return treas - WALL_COST;
        });
        setPlacingWall(false);
      } else {
        alert('Можно строить только на своей территории без построек');
      }
      return;
    }

    if (placingFactory) {
      if (map[y][x].id === playerId && map[y][x].building === 'none') {
        runTransaction(ref(database, 'blueTreasury'), (treas) => {
          if (treas < FACTORY_COST) return treas;
          runTransaction(ref(database, 'map'), (currentMap) => {
            const newMap = currentMap.map(row => row.map(cell => ({ ...cell })));
            addFactory(newMap, x, y, playerId);
            setAnimations(prev => [...prev, {x, y, type: 'capture', time: Date.now()}]);
            return newMap;
          });
          return treas - FACTORY_COST;
        });
        setPlacingFactory(false);
      } else {
        alert('Можно строить только на своей территории без построек');
      }
      return;
    }

    if (placingArtillery) {
      runTransaction(ref(database, 'map'), (currentMap) => {
        const newMap = currentMap.map(row => row.map(cell => ({ ...cell })));
        let affected = false;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (
              nx >= 0 &&
              nx < WIDTH &&
              ny >= 0 &&
              ny < HEIGHT &&
              Math.max(Math.abs(dx), Math.abs(dy)) <= 1 &&
              newMap[ny][nx].id === 2
            ) {
              newMap[ny][nx].id = 0;
              newMap[ny][nx].fort = 0;
              newMap[ny][nx].building = 'none'; // Стена или фабрика уничтожается
              affected = true;
            }
          }
        }
        if (affected) {
          runTransaction(ref(database, 'blueTreasury'), (treas) => {
            if (treas < ARTILLERY_COST) return treas;
            setAnimations(prev => [...prev, {x, y, type: 'artillery', time: Date.now()}]);
            return treas - ARTILLERY_COST;
          });
          setPlacingArtillery(false);
          return newMap;
        } else {
          alert('Нет вражеских клеток в зоне');
          return currentMap;
        }
      });
      return;
    }

    if (cooldown) return;

    if (isBorder(map, x, y, playerId)) {
      const captureSize = captureSizeLevel + 1; // 1 to 4
      const captured = [];
      for (let i = 0; i < captureSize; i++) {
        // Находим последовательные border клетки, начиная от кликнутой
        // Для простоты: захватываем в линию по горизонтали от x
        const tx = x + i;
        if (tx >= WIDTH || !isBorder(map, tx, y, playerId)) break;
        captured.push({tx, y});
      }

      if (captured.length === 0) return;

      let totalCost = 0;
      captured.forEach(({tx, ty}) => {
        const targetId = map[ty][tx].id;
        totalCost += targetId === 0 ? CAPTURE_NEUTRAL_COST : CAPTURE_ENEMY_COST;
      });

      runTransaction(ref(database, 'blueTreasury'), (treas) => {
        if (treas < totalCost) {
          alert('Недостаточно средств в казне');
          return treas;
        }
        runTransaction(ref(database, 'map'), (currentMap) => {
          const newMap = currentMap.map(row => row.map(cell => ({ ...cell })));
          captured.forEach(({tx, ty}) => {
            if (newMap[ty][tx].fort > 0) {
              newMap[ty][tx].fort--;
              if (newMap[ty][tx].fort === 0 && newMap[ty][tx].building === 'wall') {
                newMap[ty][tx].building = 'none';
              }
            } else {
              newMap[ty][tx].id = playerId;
              newMap[ty][tx].fort = 0;
            }
            setAnimations(prev => [...prev, {x: tx, y: ty, type: 'capture', time: Date.now()}]);
          });
          const withEnclaves = captureEnclaves(newMap, playerId);
          return withEnclaves;
        });
        return treas - totalCost;
      });

      setCooldown(true);
      const cdTime = Math.max(5000, 10000 - cdReductionLevel * 1000);
      setTimeout(() => setCooldown(false), cdTime);
    }
  }

  function handleMouseMoveOnCanvas(e) {
    if (!placingBunker && !placingArtillery && !placingWall && !placingFactory) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = (e.clientX - rect.left - offset.x) / zoom;
    const cy = (e.clientY - rect.top - offset.y) / zoom;
    const x = Math.floor(cx / PIXEL_SIZE);
    const y = Math.floor(cy / PIXEL_SIZE);
    setHoverX(x);
    setHoverY(y);
  }

  function handleWheel(e) {
    e.preventDefault();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const wx = (mouseX - offset.x) / zoom;
    const wy = (mouseY - offset.y) / zoom;

    let nextZoom = zoom * (e.deltaY < 0 ? 1.1 : 0.9);
    nextZoom = Math.max(0.2, Math.min(3, nextZoom));

    const newOffset = {
      x: offset.x - wx * (nextZoom - zoom),
      y: offset.y - wy * (nextZoom - zoom)
    };

    setZoom(nextZoom);
    setOffset(newOffset);
  }

  function handleMouseDown(e) {
    if (e.button === 2) {
      dragging.current = true;
      lastPos.current = { x: e.clientX, y: e.clientY };
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      e.preventDefault();
    }
  }

  function handleMouseMove(e) {
    if (dragging.current) {
      setOffset(o => ({
        x: o.x + (e.clientX - lastPos.current.x),
        y: o.y + (e.clientY - lastPos.current.y)
      }));
      lastPos.current = { x: e.clientX, y: e.clientY };
    }
  }

  function handleMouseUp(e) {
    dragging.current = false;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    if (e) e.preventDefault();
  }

  function handleContextMenu(e) {
    e.preventDefault();
  }

  function handleWork() {
    if (workCooldown) return;
    setWorkCooldown(true);
    setTimeout(() => setWorkCooldown(false), 3000);

    const profit = workLevel + globalWorkBonus;
    const toTreasury = Math.floor(profit * 0.10);
    const net = profit - toTreasury;
    const toBank = Math.floor(net * 0.10);

    runTransaction(ref(database, 'blueTreasury'), (treas) => treas + toTreasury);
    runTransaction(ref(database, `users/${user.uid}/bank`), (currentBank) => currentBank + toBank);
    runTransaction(ref(database, `users/${user.uid}/balance`), (currentBalance) => currentBalance + (net - toBank));
  }

  function handleUpgrade() {
    runTransaction(ref(database, `users/${user.uid}/balance`), (currentBalance) => {
      if (currentBalance >= workCost) {
        runTransaction(ref(database, `users/${user.uid}/workLevel`), (level) => level + 5);
        runTransaction(ref(database, `users/${user.uid}/workCost`), (cost) => Math.ceil(cost * 1.7));
        return currentBalance - workCost;
      }
      return currentBalance;
    });
  }

  function handleAiWorkUpgrade() {
    runTransaction(ref(database, `users/${user.uid}/balance`), (currentBalance) => {
      if (currentBalance >= AI_WORK_COST && !aiWorkEnabled) {
        runTransaction(ref(database, `users/${user.uid}/aiWorkEnabled`), () => true);
        return currentBalance - AI_WORK_COST;
      }
      return currentBalance;
    });
  }

  function handleUpgradeCaptureSize() {
    if (captureSizeLevel >= MAX_CAPTURE_SIZE_LEVEL) return;
    runTransaction(ref(database, `users/${user.uid}/balance`), (currentBalance) => {
      if (currentBalance >= CAPTURE_SIZE_UPGRADE_COST) {
        runTransaction(ref(database, `users/${user.uid}/captureSizeLevel`), (level) => level + 1);
        return currentBalance - CAPTURE_SIZE_UPGRADE_COST;
      }
      return currentBalance;
    });
  }

  function handleUpgradeCdReduction() {
    if (cdReductionLevel >= MAX_CD_REDUCTION_LEVEL) return;
    runTransaction(ref(database, `users/${user.uid}/balance`), (currentBalance) => {
      if (currentBalance >= CD_REDUCTION_UPGRADE_COST) {
        runTransaction(ref(database, `users/${user.uid}/cdReductionLevel`), (level) => level + 1);
        return currentBalance - CD_REDUCTION_UPGRADE_COST;
      }
      return currentBalance;
    });
  }

  function doDeposit() {
    const amount = Number(depositInput);
    if (!Number.isFinite(amount) || amount <= 0 || balance < amount) return;
    runTransaction(ref(database, `users/${user.uid}/balance`), (currentBalance) => currentBalance - amount);
    runTransaction(ref(database, `users/${user.uid}/bank`), (currentBank) => currentBank + amount);
    setDepositInput('');
  }

  function doWithdraw() {
    const amount = Number(withdrawInput);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const nowMs = Date.now();
    const cdMs = 30 * 60 * 1000;
    const passed = nowMs - lastWithdraw;

    if (passed < cdMs) {
      const left = Math.ceil((cdMs - passed) / 1000);
      alert(`Снимать можно раз в 30 минут. Осталось: ${left} сек.`);
      return;
    }
    if (bank < amount) return;
    runTransaction(ref(database, `users/${user.uid}/bank`), (currentBank) => currentBank - amount);
    runTransaction(ref(database, `users/${user.uid}/balance`), (currentBalance) => currentBalance + amount);
    runTransaction(ref(database, `users/${user.uid}/lastWithdraw`), () => nowMs);
    setWithdrawInput('');
  }

  function doDonate() {
    const amount = Number(donateInput);
    if (!Number.isFinite(amount) || amount <= 0 || balance < amount) return;
    runTransaction(ref(database, `users/${user.uid}/balance`), (currentBalance) => currentBalance - amount);
    runTransaction(ref(database, 'blueTreasury'), (treas) => treas + amount);
    setDonateInput('');
  }

  function handleUpgradeBank() {
    if (bankRate >= BANK_MAX_RATE) return;
    const cost = BANK_UPGRADE_BASE_COST * (bankUpgradeLevel + 1);
    runTransaction(ref(database, 'blueTreasury'), (treas) => {
      if (treas < cost) return treas;
      runTransaction(ref(database, 'bankUpgradeLevel'), (level) => level + 1);
      runTransaction(ref(database, 'bankRate'), (rate) => rate + BANK_RATE_STEP);
      return treas - cost;
    });
  }

  function handleBuildBunker() {
    setPlacingBunker(true);
  }

  function handleBuildWall() {
    setPlacingWall(true);
  }

  function handleBuildFactory() {
    setPlacingFactory(true);
  }

  function handleArtillery() {
    setPlacingArtillery(true);
  }

  function handleSetUsername(e) {
    const name = e.target.value.trim();
    setUsername(name);
    set(ref(database, `users/${user.uid}/username`), name);
  }

  function handleNominate() {
    if (president) return;
    if (!username) return;

    setCandidates(prev => {
      const updated = prev.includes(username) ? prev : [...prev, username];
      set(ref(database, 'candidates'), updated);
      return updated;
    });

    setVotes(prev => {
      const updated = { ...prev, [username]: prev[username] ?? 0 };
      set(ref(database, 'votes'), updated);
      return updated;
    });

    if (!votingEnd || votingEnd < Date.now()) {
      const end = Date.now() + 2 * 60 * 1000;
      set(ref(database, 'votingEnd'), end);
      setVoted(false);
      set(ref(database, `users/${user.uid}/voted`), false);
    }

    setActiveTab('elections');
  }

  function handleVote(candidate) {
    if (!candidate || voted || !votingActive()) return;

    const newVotes = { ...votes, [candidate]: (votes[candidate] || 0) + 1 };
    set(ref(database, 'votes'), newVotes);

    setVoted(true);
    set(ref(database, `users/${user.uid}/voted`), true);
  }

  function votingActive() {
    return votingEnd > Date.now();
  }

  const votingSecondsLeft = votingActive() ? Math.max(0, Math.floor((votingEnd - now) / 1000)) : 0;

  function finishElection() {
    if (!votingEnd) return;

    const entries = Object.entries(votes);
    let winner = '';
    let maxV = -1;
    for (const [name, v] of entries) {
      if (v > maxV) {
        maxV = v;
        winner = name;
      }
    }

    if (winner) {
      set(ref(database, 'president'), winner);
      const end = Date.now() + 30 * 60 * 1000;
      set(ref(database, 'presidencyEnd'), end);
    }

    set(ref(database, 'candidates'), []);
    set(ref(database, 'votes'), {});
    set(ref(database, 'votingEnd'), 0);
    // Reset voted for current user
    setVoted(false);
    set(ref(database, `users/${user.uid}/voted`), false);
  }

  function handleResign() {
    set(ref(database, 'president'), '');
    set(ref(database, 'presidencyEnd'), 0);
  }

  function handleSendMessage() {
    if (!messageInput.trim()) return;
    const newMessage = {
      user: username || 'Анон',
      text: messageInput.trim(),
      time: Date.now()
    };
    push(ref(database, 'messages'), newMessage);
    setMessageInput('');
  }

  const { p1, p2, neutral, total } = countCells(map);
  const capturedByYou = Math.max(0, p1 - initialPlayerCellsRef.current);
  const p1Pct = ((p1 / total) * 100).toFixed(2);
  const p2Pct = ((p2 / total) * 100).toFixed(2);
  const neutralPct = ((neutral / total) * 100).toFixed(2);

  const menuTabStyle = isActive => ({
    padding: '6px 12px',
    background: isActive ? '#222' : '#333',
    color: isActive ? '#ffe259' : '#fff',
    border: 'none',
    borderBottom: isActive ? '2px solid #ffe259' : '2px solid transparent',
    cursor: 'pointer',
    fontWeight: isActive ? 700 : 400,
    fontSize: 14,
    outline: 'none',
    transition: 'background 0.3s ease, color 0.3s ease, border-bottom 0.3s ease'
  });

  const presidencyLeftSec = president && presidencyEnd > now ? Math.max(0, Math.floor((presidencyEnd - now) / 1000)) : 0;

  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function fmtDate(ms) {
    const d = new Date(ms);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  }

  const nextWithdrawInSec = Math.max(0, Math.ceil((30 * 60 * 1000 - (Date.now() - lastWithdraw)) / 1000));

  const blueIncomePerMin = countResources(map, 1) * RESOURCE_INCOME + countFactories(map, 1) * FACTORY_INCOME;

  return (
    <div
      className="App"
      style={{
        width: '100vw',
        height: '100vh',
        background: '#181818',
        overflow: 'hidden',
        margin: 0,
        padding: 0,
        position: 'fixed',
        left: 0,
        top: 0
      }}
      tabIndex={0}
    >
      {/* Верхняя панель */}
      <div
        style={{
          width: '100vw',
          height: 48,
          background: '#222',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #333',
          position: 'absolute',
          left: 0,
          top: 0,
          zIndex: 10
        }}
      >
        <h2 style={{ color: '#fff', margin: '0 16px', fontSize: 20 }}>Пиксельная карта</h2>
        <div style={{ display: 'flex', gap: 8, marginRight: 16 }}>
          <button
            style={{
              background: menuOpen ? '#ffe259' : '#333',
              color: menuOpen ? '#222' : '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '6px 16px',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.2s'
            }}
            onClick={() => setMenuOpen(v => !v)}
          >
            Меню
          </button>
        </div>
      </div>

      {/* Меню вкладок (оверлей) */}
      {menuOpen && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 48,
            width: '100vw',
            background: '#181818ee',
            zIndex: 20,
            borderBottom: '1px solid #333',
            boxShadow: '0 2px 8px #000a'
          }}
        >
          <div style={{ display: 'flex', gap: 0 }}>
            {TABS.map(tab => (
              <button key={tab.key} style={menuTabStyle(activeTab === tab.key)} onClick={() => setActiveTab(tab.key)}>
                {tab.label}
              </button>
            ))}

            {president && username === president && (
              <button style={menuTabStyle(activeTab === 'president')} onClick={() => setActiveTab('president')}>
                Президент
              </button>
            )}

            {activeTab === 'elections' && (
              <button style={menuTabStyle(true)} onClick={() => setActiveTab('elections')}>
                Выборы
              </button>
            )}
          </div>

          <div style={{ padding: 16, color: '#fff', fontSize: 16, minHeight: 60 }}>
            {activeTab === 'work' && (
              <div>
                <div style={{ marginBottom: 12, fontSize: 18 }}>
                  Баланс: <span style={{ color: '#ffe259', fontWeight: 700 }}>{balance.toFixed(2)}$</span>
                </div>

                <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    onClick={handleWork}
                    disabled={workCooldown || aiWorkEnabled}
                    style={{
                      background: workCooldown || aiWorkEnabled ? '#888' : '#2196f3',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '8px 20px',
                      fontSize: 16,
                      fontWeight: 600,
                      cursor: workCooldown || aiWorkEnabled ? 'not-allowed' : 'pointer'
                    }}
                  >
                    Работать! (+{workLevel + globalWorkBonus}$)
                  </button>
                  <button
                    onClick={handleUpgrade}
                    disabled={balance < workCost}
                    style={{
                      background: balance < workCost ? '#888' : '#ffe259',
                      color: balance < workCost ? '#ccc' : '#222',
                      border: 'none',
                      borderRadius: 4,
                      padding: '8px 20px',
                      fontSize: 16,
                      fontWeight: 600,
                      cursor: balance < workCost ? 'not-allowed' : 'pointer'
                    }}
                  >
                    Прокачать ({workCost}$)
                  </button>
                  <button
                    onClick={handleAiWorkUpgrade}
                    disabled={aiWorkEnabled || balance < AI_WORK_COST}
                    style={{
                      background: aiWorkEnabled || balance < AI_WORK_COST ? '#888' : '#4caf50',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '8px 20px',
                      fontSize: 16,
                      fontWeight: 600,
                      cursor: aiWorkEnabled || balance < AI_WORK_COST ? 'not-allowed' : 'pointer'
                    }}
                  >
                    ИИ-работа ({AI_WORK_COST}$)
                  </button>
                </div>

                <div style={{ color: '#aaa', fontSize: 14, marginBottom: 16 }}>
                  Уровень: <b>{workLevel}</b> · Бонус: <b>{globalWorkBonus}</b> · Казна: <b style={{ color: '#ffe259' }}>{blueTreasury.toFixed(2)}$</b>
                  {aiWorkEnabled && <span> · ИИ активен (обслуживание 200$/мин)</span>}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
                  <input
                    value={donateInput}
                    onChange={e => setDonateInput(e.target.value)}
                    placeholder="Пожертвование"
                    style={{ background: '#222', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: '6px 10px' }}
                    inputMode="decimal"
                  />
                  <button
                    onClick={doDonate}
                    style={{ background: '#ffe259', color: '#222', border: 'none', borderRadius: 4, padding: '6px 16px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Пожертвовать
                  </button>
                </div>

                <div
                  style={{
                    borderTop: '1px solid #333',
                    paddingTop: 12,
                    display: 'grid',
                    gap: 8,
                    gridTemplateColumns: '1fr'
                  }}
                >
                  <div style={{ fontSize: 18, marginBottom: 4 }}>
                    <b>Банк</b>
                  </div>
                  <div>
                    Депозит: <b style={{ color: '#ffe259' }}>{bank.toFixed(2)}$</b>
                  </div>
                  <div style={{ color: '#aaa' }}>
                    Проценты: <b>{(bankRate * 100).toFixed(2)}%</b> /5 сек.
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      value={depositInput}
                      onChange={e => setDepositInput(e.target.value)}
                      placeholder="Внести"
                      style={{ background: '#222', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: '6px 10px' }}
                      inputMode="decimal"
                    />
                    <button
                      onClick={doDeposit}
                      style={{ background: '#2196f3', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 16px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Внести
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      value={withdrawInput}
                      onChange={e => setWithdrawInput(e.target.value)}
                      placeholder="Снять"
                      style={{ background: '#222', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: '6px 10px' }}
                      inputMode="decimal"
                    />
                    <button
                      onClick={doWithdraw}
                      style={{ background: '#f44336', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 16px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Снять
                    </button>
                    <span style={{ color: '#aaa', fontSize: 14 }}>
                      {nextWithdrawInSec > 0 ? `Через ${fmtTime(nextWithdrawInSec)}` : 'Можно сейчас'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'war' && (
              <div>
                <div style={{ marginBottom: 8, fontSize: 18 }}>
                  <b>Статистика территорий</b>
                </div>
                <div style={{ lineHeight: 1.5, fontSize: 14 }}>
                  <div>
                    Ваши клетки: <b style={{ color: colors[1] }}>{p1}</b> ({p1Pct}%)
                  </div>
                  <div>
                    Соперника: <b style={{ color: colors[2] }}>{p2}</b> ({p2Pct}%)
                  </div>
                  <div>
                    Нейтральные: <b>{neutral}</b> ({neutralPct}%)
                  </div>
                  <div style={{ marginTop: 4 }}>
                    Захвачено вами: <b style={{ color: '#ffe259' }}>{capturedByYou}</b>
                  </div>
                  <div>
                    Потери: <b style={{ color: '#f44336' }}>{playerLosses}</b>
                  </div>
                </div>
                <div style={{ marginTop: 16, fontSize: 18 }}>
                  <b>Улучшения войны</b>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  <div>
                    Размер захвата: <b>{captureSizeLevel + 1} пикселя(ей)</b> (макс 4)
                    <button
                      onClick={handleUpgradeCaptureSize}
                      disabled={captureSizeLevel >= MAX_CAPTURE_SIZE_LEVEL || balance < CAPTURE_SIZE_UPGRADE_COST}
                      style={{
                        background: captureSizeLevel >= MAX_CAPTURE_SIZE_LEVEL || balance < CAPTURE_SIZE_UPGRADE_COST ? '#888' : '#2196f3',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        padding: '4px 12px',
                        marginLeft: 8,
                        fontWeight: 600,
                        cursor: captureSizeLevel >= MAX_CAPTURE_SIZE_LEVEL || balance < CAPTURE_SIZE_UPGRADE_COST ? 'not-allowed' : 'pointer',
                        fontSize: 12
                      }}
                    >
                      Улучшить ({CAPTURE_SIZE_UPGRADE_COST}$)
                    </button>
                  </div>
                  <div>
                    Уменьшение КД: <b>{cdReductionLevel} сек</b> (макс 5 сек)
                    <button
                      onClick={handleUpgradeCdReduction}
                      disabled={cdReductionLevel >= MAX_CD_REDUCTION_LEVEL || balance < CD_REDUCTION_UPGRADE_COST}
                      style={{
                        background: cdReductionLevel >= MAX_CD_REDUCTION_LEVEL || balance < CD_REDUCTION_UPGRADE_COST ? '#888' : '#2196f3',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        padding: '4px 12px',
                        marginLeft: 8,
                        fontWeight: 600,
                        cursor: cdReductionLevel >= MAX_CD_REDUCTION_LEVEL || balance < CD_REDUCTION_UPGRADE_COST ? 'not-allowed' : 'pointer',
                        fontSize: 12
                      }}
                    >
                      Улучшить ({CD_REDUCTION_UPGRADE_COST}$)
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'politics' && (
              <div>
                <div style={{ marginBottom: 8 }}>
                  <b>Казна:</b> <span style={{ color: '#ffe259', fontWeight: 700 }}>{blueTreasury.toFixed(2)}$</span>
                  <span style={{ color: '#aaa', marginLeft: 8 }}>(+{blueIncomePerMin}$/мин от ресурсов и фабрик)</span>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <b>Имя:</b>{' '}
                  <input
                    value={username}
                    onChange={handleSetUsername}
                    style={{
                      background: '#222',
                      color: '#fff',
                      border: '1px solid #444',
                      borderRadius: 4,
                      padding: '4px 8px',
                      fontSize: 14,
                      marginLeft: 4
                    }}
                    maxLength={16}
                  />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <b>Президент:</b>{' '}
                  {president ? (
                    <span style={{ color: '#ffe259' }}>
                      {president} {presidencyLeftSec > 0 ? `(осталось ${fmtTime(presidencyLeftSec)})` : ''}
                    </span>
                  ) : (
                    'нет'
                  )}
                </div>
                <div style={{ marginBottom: 8 }}>
                  <button
                    style={{
                      background: candidates.includes(username) || !username || !!president ? '#888' : '#ffe259',
                      color: candidates.includes(username) || !username || !!president ? '#ccc' : '#222',
                      border: 'none',
                      borderRadius: 4,
                      padding: '6px 12px',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: candidates.includes(username) || !username || !!president ? 'not-allowed' : 'pointer',
                      marginRight: 8
                    }}
                    disabled={candidates.includes(username) || !username || !!president}
                    onClick={handleNominate}
                  >
                    Кандидатура
                  </button>
                  <button
                    style={{
                      background: '#2196f3',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '6px 12px',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                    onClick={() => setActiveTab('elections')}
                  >
                    Выборы
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'elections' && (
              <div>
                <div style={{ marginBottom: 8 }}>
                  {votingActive() ? (
                    <span>
                      Голосование идёт! До конца: <b>{fmtTime(votingSecondsLeft)}</b>
                    </span>
                  ) : (
                    <span>Голосование не активно</span>
                  )}
                </div>

                <div style={{ marginBottom: 8 }}>
                  <b>Кандидаты:</b>
                  <ul style={{ paddingLeft: 16, margin: 0, listStyleType: 'disc' }}>
                    {candidates.length === 0 && <li>Нет кандидатов</li>}
                    {candidates.map(name => (
                      <li key={name} style={{ margin: '2px 0', fontSize: 14 }}>
                        {name}{' '}
                        <span style={{ color: '#ffe259' }}>{votes[name] || 0} голосов</span>{' '}
                        {votingActive() && !voted && (
                          <button
                            style={{
                              background: '#2196f3',
                              color: '#fff',
                              border: 'none',
                              borderRadius: 4,
                              padding: '2px 8px',
                              marginLeft: 4,
                              cursor: 'pointer',
                              fontSize: 12
                            }}
                            onClick={() => handleVote(name)}
                          >
                            Голосовать
                          </button>
                        )}
                        {voted && <span style={{ color: '#aaa', marginLeft: 4, fontSize: 12 }}>(Проголосовали)</span>}
                      </li>
                    ))}
                  </ul>
                </div>

                {!votingActive() && (
                  <button
                    style={{
                      background: '#333',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '6px 12px',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                    onClick={() => setActiveTab('politics')}
                  >
                    Назад
                  </button>
                )}
              </div>
            )}

            {activeTab === 'chat' && (
              <div>
                <div style={{ marginBottom: 8, fontSize: 18 }}>
                  <b>Командный чат</b>
                </div>
                <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 8, padding: 6, background: '#222', borderRadius: 4 }}>
                  {messages.map((msg, idx) => (
                    <div key={idx} style={{ marginBottom: 4, borderBottom: '1px solid #333', paddingBottom: 4, fontSize: 14 }}>
                      <span style={{ color: '#ffe259', fontWeight: 600 }}>{msg.user}</span> <span style={{ color: '#aaa', fontSize: 12 }}>({fmtDate(msg.time)})</span>
                      <div>{msg.text}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={messageInput}
                    onChange={e => setMessageInput(e.target.value)}
                    placeholder="Сообщение"
                    style={{ flex: 1, background: '#222', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: '6px 10px', fontSize: 14 }}
                  />
                  <button
                    onClick={handleSendMessage}
                    style={{ background: '#2196f3', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 12px', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}
                  >
                    Отправить
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'president' && president && username === president && (
              <div>
                <div style={{ marginBottom: 8 }}>
                  <b>Вы — президент!</b> Срок: {presidencyLeftSec > 0 ? fmtTime(presidencyLeftSec) : 'истёк'}
                </div>
                <div style={{ marginBottom: 8 }}>
                  <b>Казна:</b> <span style={{ color: '#ffe259', fontWeight: 700 }}>{blueTreasury.toFixed(2)}$</span>
                  <span style={{ color: '#aaa', marginLeft: 8 }}>(+{blueIncomePerMin}$/мин от ресурсов и фабрик)</span>
                </div>
                <div style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 14 }}>
                    <b>Банк:</b> Ур. {bankUpgradeLevel}, ставка {(bankRate * 100).toFixed(2)}%
                    <button
                      onClick={handleUpgradeBank}
                      disabled={bankRate >= BANK_MAX_RATE || blueTreasury < BANK_UPGRADE_BASE_COST * (bankUpgradeLevel + 1)}
                      style={{
                        background:
                          bankRate >= BANK_MAX_RATE || blueTreasury < BANK_UPGRADE_BASE_COST * (bankUpgradeLevel + 1)
                            ? '#888'
                            : '#2196f3',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        padding: '4px 12px',
                        marginLeft: 8,
                        fontWeight: 600,
                        cursor:
                          bankRate >= BANK_MAX_RATE || blueTreasury < BANK_UPGRADE_BASE_COST * (bankUpgradeLevel + 1)
                            ? 'not-allowed'
                            : 'pointer',
                        fontSize: 12
                      }}
                    >
                      Улучшить ({BANK_UPGRADE_BASE_COST * (bankUpgradeLevel + 1)}$)
                    </button>
                  </div>
                  <div style={{ fontSize: 14 }}>
                    <b>Бункер:</b> Укрепляет 3x3
                    <button
                      onClick={handleBuildBunker}
                      disabled={blueTreasury < BUNKER_COST}
                      style={{
                        background: blueTreasury < BUNKER_COST ? '#888' : '#2196f3',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        padding: '4px 12px',
                        marginLeft: 8,
                        fontWeight: 600,
                        cursor: blueTreasury < BUNKER_COST ? 'not-allowed' : 'pointer',
                        fontSize: 12
                      }}
                    >
                      Построить ({BUNKER_COST}$)
                    </button>
                  </div>
                  <div style={{ fontSize: 14 }}>
                    <b>Стена:</b> Укрепляет 1 клетку (3 HP)
                    <button
                      onClick={handleBuildWall}
                      disabled={blueTreasury < WALL_COST}
                      style={{
                        background: blueTreasury < WALL_COST ? '#888' : '#2196f3',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        padding: '4px 12px',
                        marginLeft: 8,
                        fontWeight: 600,
                        cursor: blueTreasury < WALL_COST ? 'not-allowed' : 'pointer',
                        fontSize: 12
                      }}
                    >
                      Построить ({WALL_COST}$)
                    </button>
                  </div>
                  <div style={{ fontSize: 14 }}>
                    <b>Фабрика:</b> +20$/мин в казну
                    <button
                      onClick={handleBuildFactory}
                      disabled={blueTreasury < FACTORY_COST}
                      style={{
                        background: blueTreasury < FACTORY_COST ? '#888' : '#2196f3',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        padding: '4px 12px',
                        marginLeft: 8,
                        fontWeight: 600,
                        cursor: blueTreasury < FACTORY_COST ? 'not-allowed' : 'pointer',
                        fontSize: 12
                      }}
                    >
                      Построить ({FACTORY_COST}$)
                    </button>
                  </div>
                  <div style={{ fontSize: 14 }}>
                    <b>Артиллерия:</b> Нейтрализует 3x3 врага
                    <button
                      onClick={handleArtillery}
                      disabled={blueTreasury < ARTILLERY_COST}
                      style={{
                        background: blueTreasury < ARTILLERY_COST ? '#888' : '#f44336',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        padding: '4px 12px',
                        marginLeft: 8,
                        fontWeight: 600,
                        cursor: blueTreasury < ARTILLERY_COST ? 'not-allowed' : 'pointer',
                        fontSize: 12
                      }}
                    >
                      Запустить ({ARTILLERY_COST}$)
                    </button>
                  </div>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <button
                    style={{
                      background: '#f44336',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '8px 20px',
                      fontSize: 16,
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                    onClick={handleResign}
                  >
                    Отставка
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Карта на весь экран (под меню) */}
      <div
        ref={containerRef}
        style={{
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
          position: 'absolute',
          left: 0,
          top: 0,
          userSelect: 'none',
          cursor: dragging.current ? 'grabbing' : 'default',
          zIndex: 1
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
      >
        <canvas
          ref={canvasRef}
          width={WIDTH * PIXEL_SIZE}
          height={HEIGHT * PIXEL_SIZE}
          style={{
            display: 'block',
            position: 'absolute',
            left: 0,
            top: 0,
            cursor: dragging.current ? 'grabbing' : 'default'
          }}
          onClick={handleCanvasClick}
          onMouseMove={handleMouseMoveOnCanvas}
          onMouseDown={handleMouseDown}
          onContextMenu={handleContextMenu}
        />
      </div>

      {/* Инструкция поверх карты, снизу */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: '100vw',
          background: 'rgba(24,24,24,0.95)',
          color: '#aaa',
          fontSize: 14,
          padding: '8px 0',
          textAlign: 'center',
          zIndex: 5,
          borderTop: '1px solid #333'
        }}
      >
        Колёсико — зум, ПКМ — перемещение.<br />
        Клик по <span style={{ color: cooldown ? colors.borderDisabled : colors.border, fontWeight: 700 }}>жёлтым</span> для захвата.<br />
        Окружённые — авто.<br />
        Темнее — несколько кликов.<br />
        <span style={{ color: '#ffe259' }}>КД: {Math.max(5, 10 - cdReductionLevel)} сек</span>
      </div>
    </div>
  );
}

export default App;
