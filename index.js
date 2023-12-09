const { Miniflare } = require('miniflare');
const fs = require('fs');

const workerScript = fs.readFileSync('./worker.js').toString();

async function startMiniflare() {
  const miniflare = new Miniflare({ script: workerScript, port: 3000 });
  await miniflare.ready;

  console.log(`Miniflare is running on http://localhost:3000`);
}

startMiniflare();

const https = require('https');
keepalive();
function keepalive() {
  // 保持唤醒
  let url_host = '';
  url_host = process.env.RENDER_EXTERNAL_HOSTNAME;
  if (!url_host) return;
  https
    .get(`https://${url_host}/generate_204`, res => {
      if (res.statusCode == 204) {
      } else {
        console.log('请求错误: ' + res.statusCode);
      }
    })
    .on('error', err => {
      console.log('请求错误: ' + err);
    });
  setTimeout(() => {
    keepalive();
  }, (Math.ceil(Math.random() * 15) * 1000 * 60) / 2);
}
