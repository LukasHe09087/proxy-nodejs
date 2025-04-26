const fs = require('fs');
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
    argo_path: config_json['argo_path'] || (os.platform() == 'win32' ? './cloudflared.exe' : './cloudflared'),
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
      tls_key: Buffer.from(config_json['tls']['key'], 'base64').toString() || '',
      tls_cert: Buffer.from(config_json['tls']['cert'], 'base64').toString() || '',
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
    const resp = await fetchHandler(req, res);
    if (resp) {
      res.writeHead(resp.status, resp.headers);
      res.end(resp.data);
    }
  } catch (error) {
    const resp = makeRes('Error:\n' + error, 502);
    res.writeHead(resp.status, resp.headers);
    res.end(resp.data);
  }
});

const axios = require('axios');

const ASSET_URL = 'https://404.mise.eu.org/';

// CF proxy all, 一切给CF代理，true/false
const CFproxy = true;

/**
 * @param {any} body
 * @param {number} status
 * @param {Object<string, string>} headers
 */
function makeRes(body, status = 200, headers = {}) {
  headers['Access-Control-Allow-Methods'] = 'GET,HEAD,POST,PUT,DELETE,CONNECT,OPTIONS,TRACE,PATCH';
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
async function fetchHandler(request, resource) {
  const urlStr = request.protocol + '://' + request.get('host') + request.url;
  const urlObj = new URL(urlStr);
  let path = urlObj.href.replace(urlObj.origin + '/', '');
  path = path.replace(/http:\/(?!\/)/g, 'http://');
  path = path.replace(/https:\/(?!\/)/g, 'https://');
  let redirect = false;

  if (path == 'generate_204') {
    return makeRes('', 204);
  }
  // /all/:others
  if (path.startsWith('all/')) {
    path = path.slice(4);
    redirect = true;
  }
  // /:link
  if (path.startsWith('http')) {
    return fetchAndApply(path, request, resource, { follow_redirect: redirect });
  }
  // /set_referer/:referer header/:link
  if (path.startsWith('set_referer/')) {
    const [, ref, ...rest] = path.split('/');
    const realUrl = rest.join('/');

    return fetchAndApply(realUrl, request, resource, { follow_redirect: redirect, referer: ref });
  }
  // /keep_referer/:link
  if (path.startsWith('keep_referer/')) {
    const realUrl = path.slice('keep_referer/'.length);
    const referer = request.headers['referer'];
    return fetchAndApply(realUrl, request, resource, { follow_redirect: redirect, referer: referer });
  }
  try {
    const resp = await _request(ASSET_URL);
    return makeRes(resp.data, resp.status, resp.headers);
  } catch (error) {
    return makeRes('Error:\n' + error, 502);
  }
}

async function fetchAndApply(host, request, resource, options = {}) {
  // console.log(request);
  let f_url;
  try {
    f_url = new URL(host);
  } catch (error) {
    return error;
  }

  let response = null;
  const referer = options.referer;
  const follow_redirect = options.follow_redirect;
  if (!CFproxy) {
    response = await _request(f_url.href, {
      method: request.method,
      body: request.body,
      headers: request.headers,
      stream: true,
      follow_redirect,
    });
  } else {
    let method = request.method;
    let body = request.body;
    let new_request_headers = {
      ...request.headers,
      Host: f_url.host,
      origin: undefined,
      'x-forwarded-for': undefined,
      Referer: referer,
    };

    response = await _request(f_url.href, {
      method: method,
      body: body,
      headers: new_request_headers,
      stream: true,
      follow_redirect,
    });
  }

  let out_headers = {
    ...response.headers,
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,DELETE,CONNECT,OPTIONS,TRACE,PATCH',
    'Access-Control-Allow-Headers': '*,Authorization',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Max-Age': '86400',
  };
  // 分块传输时content-length不被发送
  // https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Headers/Transfer-Encoding
  delete out_headers['content-length'];

  let out_body = response.data;

  resource.writeHead(response.status, out_headers);

  out_body.on('data', data => {
    resource.write(data);
  });
  out_body.on('end', () => {
    resource.end(null);
  });

  return null;
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
  let keepalive_url = process.env.KEPP_ALIVE_URL;
  if (!keepalive_url) return;
  https
    .get(keepalive_url, res => {
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
  }, Math.ceil(Math.random() * 15) * 1000 * 60);
}

async function _request(url, { stream = false, method = 'GET', headers = null, body = null, follow_redirect = true } = {}) {
  return new Promise((resolve, reject) => {
    axios({
      method: method,
      url: url,
      data: body,
      headers: headers,
      maxRedirects: follow_redirect ? 5 : 0,
      responseType: stream ? 'stream' : 'arraybuffer',
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
