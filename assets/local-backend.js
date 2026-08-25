/* =====================================================================
 * Nexus AI — Local Backend Interceptor
 * ---------------------------------------------------------------------
 * Intercepts Lovable Cloud server-function calls (POST /_serverFn/<id>)
 * and answers them locally so the site runs 100% static (e.g. Vercel).
 *
 * License check: activation succeeds ONLY with the key below.
 * ===================================================================== */
(function () {
  'use strict';

  /* ------------------------- configuration ------------------------- */
  var LICENSE_KEY = 'SokAlike007';
  var LICENSE_NAME = 'Lifetime Pro';
  var LS_KEY = 'nexus_local_license';

  /* server-function ids (extracted from the bundles) */
  var FN = {
    getQuota: 'b7938cb3d2b120403d792943a29c6fd047c71ab1afbea835ef62df61cdeb6064',
    activateLicense: 'b797821299c837952074fc29949c97bd99c208aad02ea70e0779a96be8d95d77',
    adminSession: '86fe27ad6a116dca1f5e729d7a7c3c5eb7983f8ca6627aae6ea5df099deed00f',
    analyzeChart: '9eb752ccc5f96f5b9439564bd181a1794a0400e4ca993ed0a3cda0984d2da06f',
    liveSignal: '471dcfcb0d65bf3836d7d0f68daa0d76fef5c0db8f1df96a7efc820262522ecc',
    newsSignals: '0448c06248adec08775035141428ca4d646c71e4fb8b7efdef30a43033f71ce5'
  };

  /* ------------------------- tiny helpers -------------------------- */
  var origFetch = window.fetch ? window.fetch.bind(window) : null;

  function jsonResponse(obj) {
    /* the client middleware pipeline expects an envelope:
     *   {result: <payload>, error: <optional>, context: {}}            */
    return new Response(JSON.stringify({ result: obj, context: {} }), {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' }
    });
  }

  function errorResponse(message) {
    return new Response(message, {
      status: 400,
      statusText: 'Bad Request',
      headers: { 'content-type': 'text/plain' }
    });
  }

  /* --------------------- seroval request decoder ------------------- */
  /* The bundles send request payloads as seroval-serialised JSON:
   *   {"t": <tree>, "f": 63, "m": []}
   * Only a small subset is needed (strings / numbers / objects).      */
  function decodeNode(node, seen) {
    if (!node || typeof node !== 'object') return node;
    var t = node.t;
    if (t === 0 || t === 1) return node.s;            /* number | string */
    if (t === 2) {                                     /* special value  */
      switch (node.s) {
        case 0: return null;
        case 2: return true;
        case 3: return false;
        default: return undefined;
      }
    }
    if (t === 10) {                                    /* plain object   */
      if (seen.indexOf(node) !== -1) return undefined;
      seen.push(node);
      var out = {};
      var p = node.p || {};
      var keys = p.k || [];
      var vals = p.v || [];
      for (var i = 0; i < keys.length; i++) out[keys[i]] = decodeNode(vals[i], seen);
      return out;
    }
    if (node.s !== undefined && (t === 3 || t === 4 || t === 5)) {
      /* array-ish containers carry elements in "s"                    */
      if (Array.isArray(node.s)) {
        if (seen.indexOf(node) !== -1) return undefined;
        seen.push(node);
        return node.s.map(function (el) { return decodeNode(el, seen); });
      }
      return node.s;
    }
    if (t === 25) {                                    /* Error instance */
      var msg = node.s && node.s.message;
      return new Error(typeof msg === 'object' ? (msg && msg.s) || '' : msg || '');
    }
    return undefined;
  }

  function parseRequestBody(bodyText) {
    var data = {};
    if (!bodyText) return data;
    try {
      var parsed = JSON.parse(bodyText);
      var tree = parsed && parsed.t !== undefined ? parsed.t : parsed;
      var decoded = decodeNode(tree, []);
      if (decoded && typeof decoded === 'object' && decoded.data) data = decoded.data;
    } catch (e) { /* ignore malformed payloads */ }
    return data;
  }

  /* ------------------------- license state ------------------------- */
  function readLicense() {
    try {
      var raw = window.localStorage.getItem(LS_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (obj && obj.activated) return obj;
    } catch (e) { /* ignore */ }
    return null;
  }

  function writeLicense() {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify({
        activated: true,
        licenseName: LICENSE_NAME,
        activatedAt: new Date().toISOString()
      }));
    } catch (e) { /* ignore */ }
  }

  function licensedQuota() {
    return {
      licensed: true,
      licenseName: LICENSE_NAME,
      licenseExpiresAt: null,
      unlimited: true,
      limit: 999999,
      used: 0,
      remaining: 999999
    };
  }

  function freeQuota() {
    /* free tier disabled — activation with the license key is required */
    return {
      licensed: false,
      licenseName: null,
      licenseExpiresAt: null,
      unlimited: false,
      limit: 0,
      used: 0,
      remaining: 0
    };
  }

  function currentQuota() {
    return readLicense() ? licensedQuota() : freeQuota();
  }

  function requireLicense() {
    if (readLicense()) return null;
    /* message contains "limit" so the UI opens the upgrade modal */
    return 'Daily signal limit reached. Activate a license key to continue.';
  }

  /* ------------------------ signal generators ---------------------- */
  var OTC_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'EURGBP', 'AUDCAD', 'NZDCHF',
    'USDBDT', 'USDPKR', 'USDCOP', 'USDPHP', 'AUDNZD', 'CADCHF', 'EURAUD',
    'EURNZD', 'GBPCAD', 'GBPCHF', 'USDCAD', 'USDCHF', 'USDDZD', 'USDARS',
    'USDEGP', 'USDZAR', 'EURCHF', 'GBPAUD', 'AUDCHF', 'AUDUSD', 'USDBRL',
    'EURJPY', 'GBPJPY', 'NZDJPY', 'AUDJPY', 'NZDCAD', 'USDIDR', 'USDINR',
    'USDMXN', 'USDNGN', 'NZDUSD', 'GBPNZD', 'USDTRY', 'USDMYR', 'USDVND', 'USDTHB'];
  var REAL_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD',
    'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'EURCHF', 'AUDJPY', 'GBPCAD',
    'AUDCAD', 'AUDCHF', 'EURAUD', 'EURCAD', 'GBPCHF', 'AUDNZD', 'CADJPY',
    'CHFJPY', 'NZDJPY', 'EURNZD', 'GBPAUD', 'GBPNZD', 'NZDCAD', 'NZDCHF', 'CADCHF'];

  var BASE_RATES = {
    EURUSD: 1.0842, GBPUSD: 1.2687, USDJPY: 151.42, USDCHF: 0.9048,
    USDCAD: 1.3625, AUDUSD: 0.6584, NZDUSD: 0.6012, EURGBP: 0.8547,
    EURJPY: 164.18, GBPJPY: 192.07, EURCHF: 0.9810, AUDJPY: 99.68,
    GBPCAD: 1.7289, AUDCAD: 0.8972, AUDCHF: 0.5956, EURAUD: 1.6471,
    EURCAD: 1.4774, GBPCHF: 1.1478, AUDNZD: 1.0951, CADJPY: 111.13,
    CHFJPY: 167.35, NZDJPY: 90.97, EURNZD: 1.8045, GBPAUD: 1.9271,
    GBPNZD: 2.1105, NZDCAD: 0.8191, NZDCHF: 0.5439, CADCHF: 0.6639,
    USDBDT: 117.42, USDPKR: 278.35, USDCOP: 3912.5, USDPHP: 56.28,
    USDDZD: 134.28, USDARS: 872.4, USDEGP: 47.85, USDZAR: 18.72,
    USDBRL: 5.034, NZDCHFX: 0.5439, USDIDR: 15785, USDINR: 83.32,
    USDMXN: 16.74, USDNGN: 1425.6, USDTRY: 32.18, USDMYR: 4.725,
    USDVND: 24795, USDTHB: 36.42
  };

  function rnd(min, max) { return min + Math.random() * (max - min); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function fmtRate(v, pair) {
    var jpyish = /JPY|BDT|PKR|COP|IDR|INR|NGN|VND|TRY|ARS|EGP|DZD|BRL|MXN|ZAR|PHP|MYR|THB/.test(pair);
    var dec = jpyish ? 3 : 5;
    return Number(v.toFixed(dec));
  }

  function pairContext(symbol) {
    var sym = String(symbol || '').replace('_otc', '').toUpperCase();
    var base = sym.slice(0, 3);
    var quote = sym.slice(3, 6) || 'USD';
    var rate = BASE_RATES[sym] || rnd(0.55, 1.95);
    rate = rate * rnd(0.9965, 1.0035);
    return { sym: sym, base: base, quote: quote, rate: rate };
  }

  function levelsFor(rate, pair) {
    var spread = rate * rnd(0.0012, 0.0032);
    var support = fmtRate(rate - spread, pair);
    var resistance = fmtRate(rate + spread, pair);
    var pricePosition = Math.round(rnd(12, 88));
    return { support: support, resistance: resistance, pricePosition: pricePosition };
  }

  var TRENDS = ['BULLISH MOMENTUM', 'BEARISH PRESSURE', 'TREND CONTINUATION',
    'RANGING MARKET', 'HIGHER LOWS FORMING', 'LOWER HIGHS FORMING'];
  var PATTERNS = ['BULLISH ENGULFING', 'BEARISH ENGULFING', 'PIN BAR REJECTION',
    'THREE WHITE SOLDIERS', 'MORNING STAR', 'EVENING STAR', 'INSIDE BAR BREAKOUT',
    'DOJI AT KEY LEVEL', 'MARUBOZU CONTINUATION', 'TWEeZER BOTTOM'];

  function confidenceLabel(c) {
    if (c >= 82) return 'HIGH CONFIDENCE';
    if (c >= 72) return 'GOOD CONFIDENCE';
    return 'MODERATE CONFIDENCE';
  }

  /* chart analyzer (screenshot upload) */
  function makeAnalyzerSignal(mode) {
    var isOtc = String(mode || 'otc').toLowerCase() === 'otc';
    var list = isOtc ? OTC_PAIRS : REAL_PAIRS;
    var ctx = pairContext(pick(list));
    var direction = Math.random() < 0.5 ? 'UP' : 'DOWN';
    var confidence = Math.round(rnd(64, 93));
    var lv = levelsFor(ctx.rate, ctx.sym);
    var up = direction === 'UP';
    var trend = pick(TRENDS);
    return {
      direction: direction,
      base: ctx.base,
      quote: ctx.quote,
      pair: ctx.base + '/' + ctx.quote + (isOtc ? ' OTC' : ''),
      timeframe: 'M1',
      market: isOtc ? 'OTC' : 'REAL',
      option: (up ? 'CALL' : 'PUT') + ' · 1 MIN',
      confidence: confidence,
      confidenceLabel: confidenceLabel(confidence),
      support: lv.support,
      resistance: lv.resistance,
      pricePosition: lv.pricePosition,
      trend: trend,
      pattern: pick(PATTERNS),
      trendStructure: up ? 'higher highs & higher lows' : 'lower highs & lower lows',
      details: {
        structure: up
          ? 'Bullish break of structure on the last closed candle; price retested the broken level and held above it.'
          : 'Bearish break of structure on the last closed candle; retest of the broken level rejected sellers back in control.',
        candles: up
          ? 'Strong bullish close near the high with small upper wicks — buyers dominated the full candle range.'
          : 'Strong bearish close near the low with small lower wicks — sellers pressed price the whole session.',
        indicators: 'RSI ' + rnd(28, 72).toFixed(1) + ' with ' + (up ? 'bullish' : 'bearish') + ' divergence on M1; Stochastic crossing ' + (up ? 'up' : 'down') + ' from ' + (up ? 'oversold' : 'overbought') + '.',
        momentum: up ? 'Momentum shifting to the upside — each retrace is shallower than the last.' : 'Downside momentum accelerating — retraces fail before reaching prior swing points.',
        pressure: up ? 'Buyer/seller flow at ' + Math.round(rnd(56, 74)) + '% buyers — aggressive absorption of sell liquidity.' : 'Buyer/seller flow at ' + Math.round(rnd(56, 74)) + '% sellers — buy-side liquidity being swept repeatedly.',
        wicks: up ? 'Long lower wicks on the last three candles — sellers rejected at demand.' : 'Long upper wicks on the last three candles — buyers trapped at supply.',
        gaps: 'No material gaps; continuous price delivery across the analyzed window.',
        rejection: up ? 'Clean rejection wick off the intraday support zone followed by a confirmed close above it.' : 'Clean rejection wick off the intraday resistance zone followed by a confirmed close below it.',
        risk: 'Signal invalidates if price closes ' + (up ? 'below support' : 'above resistance') + ' before expiry. News spikes can overshoot levels.',
        reasoning: [
          (up ? 'Bullish' : 'Bearish') + ' market structure confirmed on the last closed candle.',
          'Price reacted precisely from the ' + (up ? 'demand' : 'supply') + ' zone at ' + (up ? lv.support : lv.resistance) + '.',
          'Momentum and RSI align with the ' + (up ? 'CALL' : 'PUT') + ' direction for the next candle.',
          'Volume pressure favours ' + (up ? 'buyers' : 'sellers') + ' into the expiry window.'
        ]
      }
    };
  }

  /* live signal page */
  function makeLiveSignal(symbol, timeframe) {
    var sym = String(symbol || 'EURUSD');
    var isOtc = /_otc/i.test(sym) || /otc/i.test(symbol);
    var ctx = pairContext(sym);
    var direction = Math.random() < 0.5 ? 'UP' : 'DOWN';
    var confidence = Math.round(rnd(66, 94));
    var lv = levelsFor(ctx.rate, ctx.sym);
    var demandMet = Math.random() < 0.55;
    var supplyMet = !demandMet && Math.random() < 0.6;
    var up = direction === 'UP';
    var rsiVal = Number(rnd(24, 76).toFixed(1));
    var demandZone = fmtRate(ctx.rate - ctx.rate * rnd(0.002, 0.004), ctx.sym);
    var supplyZone = fmtRate(ctx.rate + ctx.rate * rnd(0.002, 0.004), ctx.sym);
    return {
      direction: direction,
      pair: ctx.base + '/' + ctx.quote + (isOtc ? ' OTC' : ''),
      market: isOtc ? 'OTC' : 'REAL',
      timeframe: timeframe === 'M5' ? 'M5' : 'M1',
      base: ctx.base,
      quote: ctx.quote,
      strength: confidence,
      conviction: confidence >= 82 ? 'HIGH PROBABILITY' : confidence >= 72 ? 'GOOD PROBABILITY' : 'MODERATE PROBABILITY',
      support: lv.support,
      resistance: lv.resistance,
      trend: pick(TRENDS),
      trapLevel: fmtRate(ctx.rate * rnd(0.9988, 1.0012), ctx.sym),
      demandMet: demandMet,
      demandZone: demandZone,
      supplyMet: supplyMet,
      supplyZone: supplyZone,
      pricePosition: lv.pricePosition,
      price: fmtRate(ctx.rate, ctx.sym),
      rsi: rsiVal,
      pattern: pick(PATTERNS),
      quality: confidence >= 85 ? 'A+' : confidence >= 75 ? 'A' : 'B',
      htfTrend: up ? 'M15/M30 bullish bias' : 'M15/M30 bearish bias',
      playbook: up ? 'Demand-zone continuation playbook' : 'Supply-zone continuation playbook',
      option: up ? 'CALL' : 'PUT',
      warnings: [
        'Avoid trading into high-impact news releases within the expiry window.',
        'Risk a small fixed portion of balance per entry.'
      ],
      details: {
        demand: demandMet
          ? 'Demand at ' + demandZone + ' was filled and absorbed — bullish response off the level.'
          : 'Demand at ' + demandZone + ' remains unfilled — expect a pullback before continuation.',
        rsi: 'RSI ' + rsiVal + ' — ' + (rsiVal > 60 ? 'bullish territory with room before exhaustion' : rsiVal < 40 ? 'bearish territory with room before exhaustion' : 'neutral zone, following price direction'),
        priceAction: up ? 'Sequence of higher lows with bullish continuation candles closing near highs.' : 'Sequence of lower highs with bearish continuation candles closing near lows.',
        structure: up ? 'Bullish BOS + CHoCH confirmed on the entry timeframe.' : 'Bearish BOS + CHoCH confirmed on the entry timeframe.',
        momentum: up ? 'Impulse legs expand upward while corrective legs contract — healthy bullish delivery.' : 'Impulse legs expand downward while corrective legs contract — healthy bearish delivery.',
        risk: 'Signal voids if price closes ' + (up ? 'below ' + lv.support : 'above ' + lv.resistance) + '. Liquidity sweep beyond the trap level can invalidate early.',
        reasoning: [
          (up ? 'Bullish' : 'Bearish') + ' displacement broke structure and held the retest.',
          'Entry aligned with ' + (up ? 'demand' : 'supply') + ' zone reaction at ' + (up ? demandZone : supplyZone) + '.',
          'RSI at ' + rsiVal + ' supports continuation without immediate exhaustion risk.',
          'Higher-timeframe bias (' + (up ? 'bullish' : 'bearish') + ') agrees with the entry timeframe setup.'
        ]
      }
    };
  }

  /* news signal page */
  var NEWS_EVENTS = [
    { cur: 'USD', title: 'Non-Farm Payrolls', imp: 'High', f: '185K', p: '175K' },
    { cur: 'USD', title: 'CPI y/y', imp: 'High', f: '3.1%', p: '3.2%' },
    { cur: 'EUR', title: 'ECB Interest Rate Decision', imp: 'High', f: '4.00%', p: '4.00%' },
    { cur: 'GBP', title: 'BoE Gov Bailey Speaks', imp: 'Medium', f: '—', p: '—' },
    { cur: 'USD', title: 'Crude Oil Inventories', imp: 'Medium', f: '-1.4M', p: '3.2M' },
    { cur: 'EUR', title: 'German Flash Manufacturing PMI', imp: 'Medium', f: '42.8', p: '42.5' },
    { cur: 'GBP', title: 'GDP m/m', imp: 'High', f: '0.2%', p: '0.1%' },
    { cur: 'AUD', title: 'Employment Change', imp: 'High', f: '24.5K', p: '-65.1K' },
    { cur: 'CAD', title: 'Ivey PMI', imp: 'Medium', f: '55.4', p: '53.9' },
    { cur: 'JPY', title: 'BOJ Policy Statement', imp: 'High', f: '—', p: '—' },
    { cur: 'NZD', title: 'RBNZ Rate Statement', imp: 'High', f: '5.50%', p: '5.50%' },
    { cur: 'CHF', title: 'SNB Quarterly Assessment', imp: 'High', f: '1.75%', p: '1.75%' }
  ];
  var CALL_SETS = [['EUR/USD', 'GBP/USD', 'AUD/USD'], ['GBP/JPY', 'EUR/JPY'], ['AUD/USD', 'NZD/USD'], ['EUR/USD']];
  var PUT_SETS = [['USD/JPY', 'USD/CHF'], ['USD/CAD'], ['USD/JPY', 'USD/CHF', 'USD/CAD'], ['USD/CHF']];

  function makeNewsItems() {
    var count = Math.round(rnd(4, 7));
    var items = [];
    var now = Date.now();
    for (var i = 0; i < count; i++) {
      var ev = NEWS_EVENTS[(i * 3 + Math.floor(rnd(0, NEWS_EVENTS.length))) % NEWS_EVENTS.length];
      var time = new Date(now + rnd(20, 420) * 60000);
      var entry = new Date(time.getTime() - 300000 >= now ? time.getTime() - 300000 : time.getTime() + 60000);
      var conf = Math.round(rnd(68, 92));
      var tradable = Math.random() < 0.75;
      items.push({
        direction: Math.random() < 0.5 ? 'UP' : 'DOWN',
        currency: ev.cur,
        title: ev.title,
        time: time.toISOString(),
        impact: ev.imp,
        callPairs: pick(CALL_SETS),
        putPairs: pick(PUT_SETS),
        entryTime: entry.toISOString(),
        expiration: pick(['3 MIN', '5 MIN', '15 MIN']),
        forecast: ev.f,
        previous: ev.p,
        confidence: conf,
        tradable: tradable,
        volatility: ev.imp === 'High' ? 'EXTREME volatility expected — spreads widen sharply' : 'Elevated volatility expected',
        note: tradable
          ? 'Enter strictly at entry time with 1–2% risk. Avoid re-entry after the first spike.'
          : 'Setup is unclear — stay out of the market during this release.'
      });
    }
    items.sort(function (a, b) { return new Date(a.time) - new Date(b.time); });
    return items;
  }

  /* ------------------------ admin fallbacks ------------------------ */
  var ADMIN_EMPTY = {
    licenses: [],
    activations: [],
    users: [],
    totalAnalyses: 0,
    freeLimit: 0
  };

  /* --------------------- the request router ------------------------ */
  function handleServerFn(fnId, data) {
    /* quota ------------------------------------------------------- */
    if (fnId === FN.getQuota) {
      return jsonResponse(currentQuota());
    }

    /* license activation ------------------------------------------ */
    if (fnId === FN.activateLicense) {
      var code = String(data && data.code || '').trim();
      if (code === LICENSE_KEY) {
        writeLicense();
        return jsonResponse(licensedQuota());
      }
      return errorResponse('This license key does not exist.');
    }

    /* admin session (nav visibility) ------------------------------ */
    if (fnId === FN.adminSession) {
      return jsonResponse({ admin: false });
    }

    /* chart analyzer (screenshot) --------------------------------- */
    if (fnId === FN.analyzeChart) {
      var locked = requireLicense();
      if (locked) return errorResponse(locked);
      return jsonResponse({ quota: licensedQuota(), signal: makeAnalyzerSignal(data && data.mode) });
    }

    /* live signal ------------------------------------------------- */
    if (fnId === FN.liveSignal) {
      var locked2 = requireLicense();
      if (locked2) return errorResponse(locked2);
      return jsonResponse({
        quota: licensedQuota(),
        signal: makeLiveSignal(data && data.symbol, data && data.timeframe)
      });
    }

    /* news signals ------------------------------------------------ */
    if (fnId === FN.newsSignals) {
      var locked3 = requireLicense();
      if (locked3) return errorResponse(locked3);
      return jsonResponse({ quota: licensedQuota(), items: makeNewsItems() });
    }

    /* everything else (admin panel helpers, misc) ------------------ */
    return jsonResponse(ADMIN_EMPTY);
  }

  /* ------------------------- fetch override ------------------------ */
  if (!origFetch) return;

  window.fetch = function (input, init) {
    var url = '';
    try {
      url = typeof input === 'string' ? input : (input && input.url) || '';
    } catch (e) { /* ignore */ }

    var marker = '/_serverFn/';
    var pos = url.indexOf(marker);
    if (pos !== -1) {
      var fnId = url.slice(pos + marker.length).split('?')[0].split('#')[0];
      var bodyText = null;
      try {
        if (init && init.body) {
          bodyText = typeof init.body === 'string' ? init.body : String(init.body);
        } else if (input && typeof input !== 'string' && input.body) {
          /* Request instance — clone it to read the body */
          return input.clone().text().then(function (txt) {
            var d = parseRequestBody(txt);
            return handleServerFn(fnId, d);
          });
        }
      } catch (e) { /* ignore */ }

      var data = parseRequestBody(bodyText);
      return Promise.resolve(handleServerFn(fnId, data));
    }

    return origFetch(input, init);
  };
})();
