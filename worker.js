'use strict';

const ASSET_URL = 'https://404.full.tk/';
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
  return new Response(body, { status, headers });
}

addEventListener('fetch', e => {
  const ret = fetchHandler(e).catch(err =>
    makeRes('cfworker error:\n' + err.stack, 502)
  );
  e.respondWith(ret);
});

/**
 * @param {FetchEvent} e
 */
async function fetchHandler(e) {
  const req = e.request;
  const urlStr = req.url;
  const urlObj = new URL(urlStr);
  if (urlObj.pathname == '/generate_204') {
    let out_response = new Response('', {
      status: 204,
    });

    return out_response;
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
    return fetch(ASSET_URL);
    return Response.redirect('https://www.baidu.com/', 302);
  }
}

async function fetchAndApply(host, request, referer) {
  // console.log(request);
  let f_url = new URL(host);
  // let f_url = new URL(request.url);
  // f_url.href = host;

  let response = null;
  if (!CFproxy) {
    response = await fetch(f_url, request);
  } else {
    let method = request.method;
    let body = request.body;
    let request_headers = request.headers;
    let new_request_headers = new Headers(request_headers);
    new_request_headers.set('Host', f_url.host);
    new_request_headers.set('Referer', referer);

    response = await fetch(f_url.href, {
      method: method,
      body: body,
      headers: new_request_headers,
    });
  }

  let out_headers = new Headers(response.headers);
  if (out_headers.get('Content-Disposition') == 'attachment')
    out_headers.delete('Content-Disposition');
  let out_body = await response.body;
  // let out_body = null;
  // let contentType = out_headers.get("Content-Type");
  // if (contentType.includes("application/text")) {
  //     out_body = await response.text();
  //     // while (out_body.includes(replace_path)) out_body = out_body.replace(replace_path, replaced_path);
  // } else if (contentType.includes("text/html")) {
  //     out_body = await response.text();
  //     // while (replace_path!='/'&&out_body.includes(replace_path)) out_body = out_body.replace(replace_path, replaced_path);
  // } else {
  //     out_body = await response.body;
  // }

  out_headers.set(
    'Access-Control-Allow-Methods',
    'GET,HEAD,POST,PUT,DELETE,CONNECT,OPTIONS,TRACE,PATCH'
  );
  out_headers.set('Access-Control-Allow-Headers', '*,Authorization');
  out_headers.set('Access-Control-Allow-Origin', '*');
  out_headers.set('Access-Control-Max-Age', '86400');
  let out_response = new Response(out_body, {
    status: response.status,
    headers: out_headers,
  });

  return out_response;
}
