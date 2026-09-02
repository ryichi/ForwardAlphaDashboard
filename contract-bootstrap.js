'use strict';

// Hold data fetch completion until all synchronous scripts have loaded.
// This prevents app.js from decoding site data before contract-guard.js has
// installed the authoritative V3/V4 status and ranking rules.
(() => {
  const realFetch = window.fetch.bind(window);
  let release;
  const scriptsReady = new Promise(resolve => { release = resolve; });

  document.addEventListener('DOMContentLoaded', () => release(), { once: true });

  window.fetch = async (...args) => {
    const response = await realFetch(...args);
    await scriptsReady;
    const decoder = String(window.decodeSitePayload || '');
    if (!decoder.includes('逐檔 model_status')) {
      throw new Error('Production contract guard 未安裝，網站已 fail closed');
    }
    return response;
  };
})();
