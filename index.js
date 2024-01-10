const { Miniflare } = require('miniflare');
const fs = require('fs');
const os = require('os');

const config = (() => {
  let config_json;
  try {
    config_json = JSON.parse(process.env.CONFIG);
  } catch {
    try {
      config_json = JSON.parse(fs.readFileSync('./config.json').toString());
    } catch {
      config_json = {};
    }
  }
  let part_argo;
  if (config_json['argo']) {
    part_argo = {
      argo_path:
        config_json['argo_path'] ||
        (os.platform() == 'win32' ? './cloudflared.exe' : './cloudflared'),
      use_argo: config_json['argo']['use'] || false,
      argo_protocol: config_json['argo']['protocol'] || '',
      argo_region: config_json['argo']['region'] || '',
      argo_access_token: config_json['argo']['token'] || '',
    };
  }
  let part_tls;
  if (config_json['tls']) {
    part_tls = {
      use_tls: config_json['tls']['use'] || false,
      // please use base64 encode
      tls_key:
        Buffer.from(config_json['tls']['key'], 'base64').toString() || '',
      tls_cert:
        Buffer.from(config_json['tls']['cert'], 'base64').toString() || '',
    };
  }
  return {
    // core
    port: config_json['port'] || 3000,
    // tls
    ...part_tls,
    // argo (cloudflared)
    ...part_argo,
  };
})();
const workerScript = fs.readFileSync('./worker.js').toString();
const listen_host = '0.0.0.0';

async function startMiniflare() {
  const miniflare = new Miniflare({
    https: config.use_tls,
    httpsKey: config.tls_key,
    httpsCert: config.tls_cert,
    script: workerScript,
    host: listen_host,
    port: config.port,
  });
  await miniflare.ready;

  console.log(`Miniflare is running on http://${listen_host}:${config.port}`);
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
