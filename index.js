const { Miniflare } = require('miniflare');
const fs = require('fs');

const workerScript = fs.readFileSync('./worker.js').toString();

async function startMiniflare() {
  const miniflare = new Miniflare({ script: workerScript, port: 3000 });
  await miniflare.ready;

  console.log(`Miniflare is running on http://localhost:3000`);
}

startMiniflare();
