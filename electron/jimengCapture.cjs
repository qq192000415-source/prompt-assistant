// 移植自 SuYan（MIT，guliacer）electron/preload/jimengCapture.ts，去掉类型改成 .cjs。
// 只在抓取即梦分享链接的隐藏窗口里加载：截获页面自己请求的作品信息接口，把返回内容交给主进程解析。
const { ipcRenderer } = require('electron');

const TARGET_PATH = '/mweb/v1/get_item_info';
const CAPTURE_CHANNEL = 'jimeng-capture:item-info';

function report(url, body) {
  if (!body) return;
  try {
    ipcRenderer.send(CAPTURE_CHANNEL, { url, body });
  } catch {
    // 窗口已关闭时发不出去，忽略。
  }
}

const isTargetUrl = (url) => typeof url === 'string' && url.includes(TARGET_PATH);

const originalFetch = window.fetch;
if (typeof originalFetch === 'function') {
  window.fetch = function patchedFetch(...args) {
    return originalFetch.apply(this, args).then((response) => {
      try {
        const input = args[0];
        const requestUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input instanceof Request ? input.url : response.url || '';
        const finalUrl = requestUrl || response.url || '';
        if (isTargetUrl(finalUrl)) {
          response
            .clone()
            .text()
            .then((text) => report(finalUrl, text))
            .catch(() => undefined);
        }
      } catch {
        // 截获失败不影响页面本身。
      }
      return response;
    });
  };
}

const OriginalXHR = window.XMLHttpRequest;
if (typeof OriginalXHR === 'function') {
  function PatchedXHR() {
    const xhr = new OriginalXHR();
    let requestUrl = '';
    const originalOpen = xhr.open;
    xhr.open = function open(method, url, ...rest) {
      requestUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : '';
      return Reflect.apply(originalOpen, this, [method, url, ...rest]);
    };
    xhr.addEventListener('load', () => {
      try {
        if (isTargetUrl(requestUrl) && typeof xhr.responseText === 'string') {
          report(requestUrl, xhr.responseText);
        }
      } catch {
        // 同上。
      }
    });
    return xhr;
  }
  PatchedXHR.prototype = OriginalXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;
}
