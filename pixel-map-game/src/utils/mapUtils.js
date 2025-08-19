function generateMap() {
  const WIDTH = 320;
  const HEIGHT = 192;
  return Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x < 20 ? 1 : x > WIDTH - 21 ? 2 : 0))
  );
}

function isBorder(map, x, y, playerId) {
  if (map[y][x] === playerId) return false;
  const dirs = [
    [0, 1], [1, 0], [0, -1], [-1, 0]
  ];
  return dirs.some(([dx, dy]) => {
    const nx = x + dx, ny = y + dy;
    return nx >= 0 && nx < map[0].length && ny >= 0 && ny < map.length && map[ny][nx] === playerId;
  });
}

function captureEnclaves(map, playerId) {
  const visited = Array.from({ length: map.length }, () => Array(map[0].length).fill(false));
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
        if (nx < 0 || nx >= map[0].length || ny < 0 || ny >= map.length) {
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

  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[0].length; x++) {
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

export { generateMap, isBorder, captureEnclaves };