import React, { useState, useRef, useEffect } from 'react';
import './App.css';

const WIDTH = 320;
const HEIGHT = 192;
const PIXEL_SIZE = 6;

function generateMap() {
  const map = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x < 20 ? 1 : x > WIDTH - 21 ? 2 : 0))
  );
  return map;
}

function isBorder(map, x, y, playerId) {
  if (map[y][x] === playerId) return false;
  const dirs = [
    [0, 1], [1, 0], [0, -1], [-1, 0]
  ];
  return dirs.some(([dx, dy]) => {
    const nx = x + dx, ny = y + dy;
    return nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT && map[ny][nx] === playerId;
  });
}

function captureEnclaves(map, playerId) {
  const visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
  const newMap = map.map(row => [...row]);
  const targetIds = playerId === 1 ? [0, 2] : [0, 1];

  function bfs(sx, sy) {
    const queue = [[sx, sy]];
    const area = [[sx, sy]];
    visited[sy][sx] = true;
    let isEnclave = true;

    while (queue.length) {
      const [x, y] = queue.pop();
      for (const [dx, dy] of [[0,1],[1,0],[0,-1],[-1,0]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= HEIGHT) {
          isEnclave = false;
          continue;
        }
        if (!visited[ny][nx] && targetIds.includes(map[ny][nx])) {
          visited[ny][nx] = true;
          queue.push([nx, ny]);
          area.push([nx, ny]);
        }
        if (!targetIds.includes(map[ny][nx]) && map[ny][nx] !== playerId) {
          isEnclave = false;
        }
      }
    }
    return isEnclave ? area : [];
  }

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (!visited[y][x] && targetIds.includes(map[y][x])) {
        const area = bfs(x, y);
        if (area.length) {
          for (const [ax, ay] of area) {
            newMap[ay][ax] = playerId;
          }
        }
      }
    }
  }
  return newMap;
}

const colors = {
  0: '#222',
  1: '#2196f3', // синий
  2: '#f44336', // красный
  border: '#ffe259'
};

function App() {
  const [map, setMap] = useState(generateMap());
  const playerId = 1; // всегда синие
  const [cooldown, setCooldown] = useState(false);

  // Зум и перемещение
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  // WASD перемещение
  useEffect(() => {
    function handleKey(e) {
      const step = 40 / zoom;
      if (e.key === 'w' || e.key === 'ArrowUp') setOffset(o => ({ ...o, y: o.y + step }));
      if (e.key === 's' || e.key === 'ArrowDown') setOffset(o => ({ ...o, y: o.y - step }));
      if (e.key === 'a' || e.key === 'ArrowLeft') setOffset(o => ({ ...o, x: o.x + step }));
      if (e.key === 'd' || e.key === 'ArrowRight') setOffset(o => ({ ...o, x: o.x - step }));
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [zoom]);

  // Центрирование карты при первом рендере
  useEffect(() => {
    if (containerRef.current) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setOffset({
        x: (vw - WIDTH * PIXEL_SIZE) / 2,
        y: (vh - HEIGHT * PIXEL_SIZE) / 2
      });
    }
  }, []);

  // Рисуем карту на canvas
  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.setTransform(zoom, 0, 0, zoom, offset.x, offset.y);

    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        let color = colors[map[y][x]];
        if (isBorder(map, x, y, playerId)) color = colors.border;
        ctx.fillStyle = color;
        ctx.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
      }
    }
  }, [map, zoom, offset, playerId]);

  // Обработка клика по canvas
  function handleCanvasClick(e) {
    if (cooldown) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = (e.clientX - rect.left - offset.x) / zoom;
    const cy = (e.clientY - rect.top - offset.y) / zoom;
    const x = Math.floor(cx / PIXEL_SIZE);
    const y = Math.floor(cy / PIXEL_SIZE);
    if (
      x >= 0 && x < WIDTH &&
      y >= 0 && y < HEIGHT &&
      isBorder(map, x, y, playerId)
    ) {
      const newMap = map.map(row => [...row]);
      newMap[y][x] = playerId;
      const withEnclaves = captureEnclaves(newMap, playerId);
      setMap(withEnclaves);
      setCooldown(true);
      setTimeout(() => setCooldown(false), 3000);
    }
  }

  // Зум колесиком
  function handleWheel(e) {
    e.preventDefault();
    let nextZoom = zoom * (e.deltaY < 0 ? 1.1 : 0.9);
    nextZoom = Math.max(0.2, Math.min(3, nextZoom));
    setZoom(nextZoom);
  }

  // Перемещение мышью (правая кнопка)
  function handleMouseDown(e) {
    if (e.button === 2) {
      dragging.current = true;
      lastPos.current = { x: e.clientX, y: e.clientY };
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
  }
  function handleMouseMove(e) {
    if (dragging.current) {
      setOffset(o => ({
        x: o.x + (e.clientX - lastPos.current.x) / zoom,
        y: o.y + (e.clientY - lastPos.current.y) / zoom
      }));
      lastPos.current = { x: e.clientX, y: e.clientY };
    }
  }
  function handleMouseUp() {
    dragging.current = false;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }
  function handleContextMenu(e) {
    e.preventDefault();
  }

  return (
    <div
      className="App"
      style={{
        minHeight: '100vh',
        background: '#181818',
        overflow: 'hidden',
        margin: 0,
        padding: 0
      }}
      tabIndex={0}
    >
      <header className="App-header" style={{ padding: 8 }}>
        <h2 style={{ color: '#fff', marginBottom: 8 }}>Пиксельная карта</h2>
        <div
          ref={containerRef}
          style={{
            width: '100vw',
            height: '90vh',
            overflow: 'hidden',
            position: 'relative',
            background: '#222',
            border: '1px solid #333',
            margin: '0 auto',
            userSelect: 'none',
            cursor: dragging.current ? 'grabbing' : 'default'
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
              width: WIDTH * PIXEL_SIZE,
              height: HEIGHT * PIXEL_SIZE,
              cursor: dragging.current ? 'grabbing' : 'default'
            }}
            onClick={handleCanvasClick}
          />
        </div>
        <p style={{ marginTop: 8, color: '#aaa', fontSize: 15 }}>
          Колёсико мыши — зум, правая кнопка мыши или WASD — перемещение.<br />
          Кликайте по <span style={{ color: colors.border, fontWeight: 700 }}>жёлтым</span> пикселям для захвата территории.<br />
          Окружённые пиксели автоматически переходят к вам.<br />
          <span style={{ color: '#ffe259' }}>Кулдаун на захват: 3 секунды</span>
        </p>
      </header>
    </div>
  );
}

export default App;