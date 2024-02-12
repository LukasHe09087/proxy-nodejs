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
app.use(async (req, res, next) => {
  try {
    const resp = await fetchHandler(req);
    res.writeHead(resp.status, resp.headers);
    res.end(resp.data);
  } catch (error) {
    const resp = makeRes('Error:\n' + error, 502);
    res.writeHead(resp.status, resp.headers);
    res.end(resp.data);
  }
});

const axios = require('axios');

const ASSET_URL = 'https://404.mise.eu.org/';
// 前缀，如果自定义路由为example.com/gh/*，将PREFIX改为 '/gh/'，注意，少一个杠都会错！
const PREFIX = '/';

// CF proxy all, 一切给CF代理，true/false
const CFproxy = true;

/**
 * @param {any} body
 * @param {number} status
 * @param {Object<string, string>} headers
 */
function makeRes(body, status = 200, headers = {}) {
  headers['Access-Control-Allow-Methods'] =
    'GET,HEAD,POST,PUT,DELETE,CONNECT,OPTIONS,TRACE,PATCH';
  headers['Access-Control-Allow-Headers'] = '*,Authorization';
  headers['Access-Control-Allow-Origin'] = '*';
  return {
    data: body,
    status: status,
    headers: headers,
  };
}

/**
 * @param {FetchEvent} e
 */
async function fetchHandler(req) {
  const urlStr = req.protocol + '://' + req.get('host') + req.url;
  const urlObj = new URL(urlStr);
  if (urlObj.pathname == '/generate_204') {
    return makeRes('', 204);
  } else if (urlObj.pathname !== PREFIX) {
    let path = urlObj.href.replace(urlObj.origin + '/', '');
    path = path.replace(/http:/g, 'http:/');
    path = path.replace(/https:/g, 'https:/');
    // console.log(req.headers.get('referer'));
    let referer = '';
    if (path.substring(0, 1) == ':') {
      let path_split = path.split(':');
      if (req.headers.get('referer')) {
        referer = req.headers.get('referer');
      }
      let array = [];
      for (let i = 0; i + 1 < path_split.length; i++) {
        array[i] = path_split[i + 1];
      }
      path = array.join(':');
    } else if (path.substring(0, 1) == ';') {
      let path_split = path.split(';');
      // console.log(path_split[1]);
      referer = path_split[1];
      let array = [];
      for (let i = 0; i + 2 < path_split.length; i++) {
        array[i] = path_split[i + 2];
      }
      path = array.join(';');
    }
    // console.log(path);

    return fetchAndApply(path, req, referer);
  } else {
    try {
      const resp = await _request(ASSET_URL);
      return makeRes(resp.data, resp.status, resp.headers);
    } catch (error) {
      return makeRes('Error:\n' + error, 502);
    }
  }
}

async function fetchAndApply(host, request, referer) {
  // console.log(request);
  let f_url = new URL(host);
  // let f_url = new URL(request.url);
  // f_url.href = host;

  let response = null;
  if (!CFproxy) {
    response = await _request(f_url.href, {
      method: request.method,
      body: request.body,
      headers: request.headers,
    });
  } else {
    let method = request.method;
    let body = request.body;
    let new_request_headers = {
      ...request.headers,
      Host: f_url.host,
      Referer: referer,
    };

    response = await _request(f_url.href, {
      method: method,
      body: body,
      headers: new_request_headers,
    });
  }

  let out_headers = {
    ...response.headers,
    'Access-Control-Allow-Methods':
      'GET,HEAD,POST,PUT,DELETE,CONNECT,OPTIONS,TRACE,PATCH',
    'Access-Control-Allow-Headers': '*,Authorization',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Max-Age': '86400',
  };
  let out_body = response.data;

  return makeRes(out_body, response.status, out_headers);
}

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
async function _request(
  url,
  { method = 'GET', headers = null, body = null } = {}
) {
  return new Promise((resolve, reject) => {
    axios({
      method: method,
      url: url,
      data: body,
      headers: headers,
    })
      .then(response => {
        try {
          const data = response;
          resolve(data);
        } catch (error) {
          reject(error);
        }
      })
      .catch(error => {
        if (error.response) {
          // 请求成功发出且服务器也响应了状态码，但状态代码超出了 2xx 的范围
          try {
            const data = error.response;
            resolve(data);
          } catch (error) {
            reject(error);
          }
        } else if (error.request) {
          // 请求已经成功发起，但没有收到响应
          // `error.request` 在浏览器中是 XMLHttpRequest 的实例，
          // 而在node.js中是 http.ClientRequest 的实例
          console.error(error.request);
          reject('Error when response. ' + error.request);
        } else {
          // 发送请求时出了点问题
          reject('Error when send. ' + error.message);
        }
        reject(error.config);
      });
  });
}
