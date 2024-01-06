const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

let child;

function startChild() {
  child = cp.fork(path.join(__dirname, 'index.js'));

  child.on('message', data => {
    console.log(data);
  });
  child.on('error', data => {
    console.error(data);
  });

  child.on('close', code => {
    console.log(
      `\x1b[33m[Daemon]\x1b[0m Child process exited with code ${code}. Restarting...`
    );
    startChild();
  });
}

startChild();

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
  return {
    // core
    port: config_json['port'] || 3000,
    // argo (cloudflared)
    ...part_argo,
  };
})();

(async () => {
  if (config.use_argo) {
    if (!fs.existsSync(path.resolve(process.cwd(), config.argo_path))) {
      const foo = await download_argo();
      if (foo) {
        console.log('[初始化]', 'argo下载成功');
      } else {
        console.log('[初始化]', 'argo下载失败');
      }
    } else {
      console.log('[初始化]', 'argo已存在');
    }
    console.log(await start_argo());
  }
})();

// 下载argo
function download_argo() {
  return new Promise(async resolve => {
    let url =
      'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
    if (os.platform() == 'win32') {
      url =
        'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
    }
    try {
      const res = await (
        await fetch(url, {
          redirect: 'follow',
        })
      ).arrayBuffer();
      fs.writeFileSync(
        path.resolve(process.cwd(), config.argo_path),
        Buffer.from(res)
      );
      resolve(true);
    } catch (err) {
      console.log(err);
      resolve(false);
    }
  });
}
// 启动argo
async function start_argo() {
  await (_ => {
    return new Promise(async resolve => {
      if (os.platform() != 'linux') {
        resolve();
        return;
      }
      let args = ['+x', path.resolve(process.cwd(), config.argo_path)];
      let processC = cp.spawn('chmod', args);
      processC.on('close', () => {
        console.log('[初始化]', 'argo chmod完成');
        setTimeout(_ => resolve(), 100);
      });
    });
  })();

  let args = ['--url', `http://localhost:${config.port}`];
  if (config.argo_access_token) {
    args = ['run', '--token', config.argo_access_token];
    console.log('[Argo Config]', 'domain: Custom Token');
  }
  if (config.argo_protocol) {
    args.push('--protocol', config.argo_protocol);
  }
  if (config.argo_region) {
    args.push('--region', config.argo_region);
  }
  let processC = cp.spawn(path.resolve(process.cwd(), config.argo_path), [
    'tunnel',
    '--no-autoupdate',
    ...args,
  ]);
  return new Promise(resolve => {
    processC.stderr.on('data', data => {
      // https://.*[a-z]+cloudflare.com
      if (/Registered tunnel connection/.test(data)) {
        console.log(
          '[Argo Info]',
          data
            .toString()
            .match(/(?<=Registered tunnel connection).*/)[0]
            .trim()
        );
      } else if (
        !config.argo_access_token &&
        /https:\/\/.*[a-z]+cloudflare.com/.test(data)
      ) {
        console.log(
          '[Argo Config]',
          `domain: ${
            data.toString().match(/(?<=https:\/\/).*[a-z]+cloudflare.com/)[0]
          }`
        );
      } else {
        // console.log(data.toString().trim());
      }
      resolve('[初始化] argo启动成功');
    });
    processC.on('error', err => {
      resolve('[初始化] argo启动错误：' + err);
    });
  });
}
