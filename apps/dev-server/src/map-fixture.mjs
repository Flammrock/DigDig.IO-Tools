/** Independently authored terrain: no game bytes, memory, or assets. */
export function runMapFixture() {
  const canvas = document.getElementById('terrain');
  const output = document.getElementById('map-state');
  const context = canvas.getContext('2d');
  const tiles = [];
  for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 8; gx++) {
    const image = document.createElement('canvas');
    image.width = image.height = 64;
    const paint = image.getContext('2d');
    paint.fillStyle = ['#35434c', '#3e5058', '#485b63'][(gx + gy) % 3];
    paint.fillRect(0, 0, 64, 64);
    for (let index = 0; index < 22; index++) {
      const x = (index * 19 + gx * 11 + gy * 17) % 60;
      const y = (index * 31 + gx * 23 + gy * 7) % 60;
      paint.fillStyle = ['#a3db9b', '#edba69', '#8dc7eb'][(index + gx) % 3];
      paint.fillRect(x, y, 3, 3);
    }
    paint.strokeStyle = '#6e8691';
    paint.strokeRect(0, 0, 64, 64);
    tiles.push({ image, gx, gy });
  }
  const started = performance.now();
  let paused = false;
  let frozenTime = 0;
  document.getElementById('pause-map').addEventListener('click', (event) => {
    paused = !paused;
    if (paused) frozenTime = (performance.now() - started) / 1000;
    event.target.textContent = paused ? 'Resume camera' : 'Pause camera';
  });
  function draw(now) {
    const time = paused ? frozenTime : (now - started) / 1000;
    const x = 4096 + Math.cos(time / 8) * 1800;
    const y = 4096 + Math.sin(time / 8) * 1800;
    const scale = 0.15;
    output.textContent = JSON.stringify({
      world: { centerX: 4096, centerY: 4096, radius: 4096 },
      player: { x, y, normalizedX: (x - 4096) / 4096, normalizedY: (y - 4096) / 4096 },
      camera: { x, y, scale, width: canvas.width, height: canvas.height }
    });
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#151d26';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(scale, 0, 0, scale, canvas.width / 2 - x * scale, canvas.height / 2 - y * scale);
    context.imageSmoothingEnabled = false;
    for (const tile of tiles) context.drawImage(tile.image, tile.gx * 1024 - 1, tile.gy * 1024 - 1, 1026, 1026);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.strokeStyle = '#fff';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(canvas.width / 2, canvas.height / 2, 9, 0, Math.PI * 2);
    context.stroke();
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}
