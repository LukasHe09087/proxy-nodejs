const cryptoJS = require('crypto-js');
const os = require('os');
const http = require('http');
const https = require('https');

const config = (() => {
  let config_json;
  try {
    config_json = JSON.parse(process.env.CONFIG);
  } catch {
    try {
      config_json = JSON.parse(fs.readFileSync('./config.json').toString());
    } catch {
      console.log('[软件]', `Config Error`);
      config_json = {};
    }
  }
  let part_argo = {
    argo_path:
      config_json['argo_path'] ||
      (os.platform() == 'win32' ? './cloudflared.exe' : './cloudflared'),
  };
  if (config_json['argo']) {
    part_argo = {
      ...part_argo,
      use_argo: config_json['argo']['use'] || false,
      argo_protocol: config_json['argo']['protocol'] || '',
      argo_region: config_json['argo']['region'] || '',
      argo_access_token: config_json['argo']['token'] || '',
    };
  }
  let part_tls = {};
  if (config_json['tls']) {
    part_tls = {
      ...part_tls,
      use_tls: config_json['tls']['use'] || false,
      // please use base64 encode
      tls_key:
        Buffer.from(config_json['tls']['key'], 'base64').toString() || '',
      tls_cert:
        Buffer.from(config_json['tls']['cert'], 'base64').toString() || '',
    };
  }
  return {
    port: config_json['port'] || 3000,
    // tls
    ...part_tls,
    // argo (cloudflared)
    ...part_argo,
  };
})();
const proxy_address = '';
const api_address = 'https://api.v2rayse.com/api/oss';
const user_agent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36';
function getCfVerify() {
  return cryptoJS.AES.encrypt(
    Date.now().toString(),
    cryptoJS.enc.Base64.parse('plr4EY25bk1HbC6a+W76TQ=='),
    { mode: cryptoJS.mode.ECB, padding: cryptoJS.pad.Pkcs7 }
  ).toString();
}

async function getList(password) {
  if (!password) return;
  let request = await (
    await fetch(proxy_address + api_address + '/' + password, {
      method: 'GET',
      headers: {
        'cf-verify': getCfVerify(),
        'User-Agent': user_agent,
      },
    })
  ).json();
  // console.log(request);
  return request;
}
async function getFile(file_url) {
  if (!file_url) return;
  let request = await (
    await fetch(proxy_address + file_url, {
      method: 'GET',
      headers: {
        'User-Agent': user_agent,
      },
    })
  ).text();
  // console.log(request);
  return request;
}
async function setFile(password, folder, name, content) {
  if (!password || !folder || !name || !content) return;
  let body = {
    id: null,
    name: name,
    folder: folder,
    content: content,
    password: password,
  };
  let request = await (
    await fetch(proxy_address + api_address, {
      method: 'POST',
      headers: {
        'cf-verify': getCfVerify(),
        'User-Agent': user_agent,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  ).json();
  // console.log(request);
  return request;
}
async function delFile(password, folder, name) {
  if (!password || !folder || !name) return;
  let body = {
    id: null,
    name: name,
    folder: folder,
    password: password,
  };
  let request = await (
    await fetch(proxy_address + api_address, {
      method: 'DELETE',
      headers: {
        'cf-verify': getCfVerify(),
        'User-Agent': user_agent,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  ).json();
  // console.log(request);
  return request;
}
module.exports = {
  getList,
  getFile,
  setFile,
  delFile,
};

const express = require('express');
const compression = require('compression');
const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use((req, res, next) => {
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,HEAD,POST,PUT,DELETE,CONNECT,OPTIONS,TRACE,PATCH'
  );
  res.setHeader('Access-Control-Allow-Headers', '*,Authorization');
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/generate_204', (req, res) => {
  res.status(204);
  res.end('');
});
app.use((req, res, next) => {
  let data = [];
  req.on('data', chunk => {
    data.push(chunk);
  });
  req.on('end', () => {
    req.body = Buffer.concat(data);
    next();
  });
});

app.use('/getList', async (req, res) => {
  try {
    const password = req.url.substring(1);
    const response = await getList(password);
    res.send(response);
  } catch (error) {
    res.status(500).send({ error: 'An error occurred' });
  }
});
app.use('/getFile', async (req, res) => {
  try {
    res.header('content-type', 'text/plain');
    const file_url = req.url.substring(1);
    const response = await getFile(file_url);
    res.send(response);
  } catch (error) {
    res.status(500).send({ error: 'An error occurred' });
  }
});
app.post('/setFile', async (req, res) => {
  try {
    const { password, folder, name, content } = JSON.parse(req.body);
    const response = await setFile(password, folder, name, content);
    res.send(response);
  } catch (error) {
    res.status(500).send({ error: 'An error occurred' });
  }
});
app.post('/delFile', async (req, res) => {
  try {
    const { password, folder, name } = JSON.parse(req.body);
    const response = await delFile(password, folder, name);
    res.send(response);
  } catch (error) {
    res.status(500).send({ error: 'An error occurred' });
  }
});

// 处理 404 错误
app.use((req, res) => {
  // 防止浏览器POST跨域预检错误
  if (req.method == 'OPTIONS') {
    res.end('');
  } else {
    res.status(404).header({ 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

// 启动服务器
listen_port();
// 监听端口
function listen_port() {
  let serverProxy;
  if (config.use_tls) {
    console.log('[软件]', `Enabled https`);
    if (config.tls_cert && config.tls_key) {
      const options = {
        key: config.tls_key,
        cert: config.tls_cert,
      };
      serverProxy = https.createServer(options, app);
    } else {
      console.log('[软件]', `https missing: tls_cert,tls_key`);
    }
  } else {
    serverProxy = http.createServer(app);
  }
  serverProxy.listen(config.port, () => {
    console.log('[软件]', `Listening on port ${config.port}`);
  });
}

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
