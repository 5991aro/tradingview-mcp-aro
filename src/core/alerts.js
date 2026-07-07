/**
 * Core alert logic — uses TradingView pricealerts REST API via synchronous XHR.
 * text/plain Content-Type avoids CORS preflight while still sending JSON body.
 */
import { evaluate, evaluateAsync, getClient } from '../connection.js';

const BASE = 'https://pricealerts.tradingview.com';

// Map condition strings to TradingView API condition types.
// NOTE: greater_than/less_than map to CROSSING conditions — the alert only fires
// when price crosses the level, not while it is already beyond it. An alert set
// with greater_than while price is already above the level will NOT fire until
// price dips below and crosses up again. (True static greater/less conditions
// have not been verified against the pricealerts API yet — see CODE_REVIEW doc.)
const CONDITION_MAP = {
  greater_than: 'cross_up',
  less_than:    'cross_down',
  crossing:     'cross',
  cross_up:     'cross_up',
  cross_down:   'cross_down',
  cross:        'cross',
};

function xhrEval(path, bodyObj) {
  return `
    (function() {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '${BASE}${path}', false);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Content-Type', 'text/plain');
      xhr.send(JSON.stringify(window._xhrPayload));
      try { return JSON.parse(xhr.responseText); }
      catch(e) { return { s: 'error', errmsg: 'parse error: ' + xhr.responseText.substring(0, 100) }; }
    })()
  `;
}

export async function create({ condition, price, message, symbol }) {
  // Resolve active chart symbol if not provided
  if (!symbol) {
    const raw = await evaluate(`
      (function() {
        try { return window.TradingViewApi._activeChartWidgetWV.value().symbol(); } catch(e) {}
        return null;
      })()
    `);
    symbol = raw || null;
    if (!symbol) return { success: false, error: 'Could not determine active chart symbol. Pass symbol explicitly.', source: 'rest_api' };
  }

  const tvCondition = CONDITION_MAP[condition] || 'cross';
  const payload = {
    conditions: [{
      type: tvCondition,
      frequency: 'on_first_fire',
      series: [{ type: 'barset' }, { type: 'value', value: Number(price) }],
      resolution: '1',
    }],
    symbol: `={"adjustment":"splits","currency-id":"USD","session":"extended","symbol":"${symbol}"}`,
    resolution: '1',
    message: message || `${symbol} ${condition} ${price}`,
    sound_file: 'alert/soft/droplet',
    sound_duration: 0,
    popup: true,
    auto_deactivate: false,
    email: false,
    sms_over_email: false,
    mobile_push: true,
    web_hook: null,
    name: null,
    expiration: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    active: true,
    ignore_warnings: true,
  };

  await evaluate(`window._xhrPayload = { payload: ${JSON.stringify(payload)} }`);
  const result = await evaluate(xhrEval('/create_alert'));

  return {
    success: result?.s === 'ok',
    alert_id: result?.r?.alert_id || null,
    price,
    symbol,
    condition: tvCondition,
    message: payload.message,
    error: result?.errmsg || null,
    source: 'rest_api',
    note: (condition === 'greater_than' || condition === 'less_than')
      ? `"${condition}" is implemented as a CROSSING condition (${tvCondition}): it fires when price crosses ${price}, not while price is already beyond it.`
      : undefined,
  };
}

export async function list({ symbol } = {}) {
  const result = await evaluateAsync(`
    fetch('${BASE}/list_alerts', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.s !== 'ok' || !Array.isArray(data.r)) return { alerts: [], error: data.errmsg || 'Unexpected response' };
        return {
          alerts: data.r.map(function(a) {
            var sym = '';
            try { sym = JSON.parse(a.symbol.replace(/^=/, '')).symbol || a.symbol; } catch(e) { sym = a.symbol; }
            return {
              alert_id: a.alert_id,
              symbol: sym,
              type: a.type,
              message: a.message,
              active: a.active,
              condition: a.condition,
              resolution: a.resolution,
              created: a.create_time,
              last_fired: a.last_fire_time,
              expiration: a.expiration,
            };
          })
        };
      })
      .catch(function(e) { return { alerts: [], error: e.message }; })
  `);
  let alerts = result?.alerts || [];
  if (symbol) {
    const upper = symbol.toUpperCase();
    alerts = alerts.filter(a => {
      if (!a.symbol) return false;
      const sym = a.symbol.toUpperCase();
      return sym === upper || sym.endsWith(':' + upper);
    });
  }
  return { success: true, alert_count: alerts.length, source: 'rest_api', alerts, error: result?.error };
}

export async function deleteById(alert_id) {
  await evaluate(`window._xhrPayload = { payload: { alert_ids: [${alert_id}] } }`);
  const result = await evaluate(xhrEval('/delete_alerts'));
  return { success: result?.s === 'ok', alert_id, source: 'rest_api', error: result?.errmsg || null };
}

export async function deleteAlerts({ delete_all }) {
  if (!delete_all) throw new Error('Use alert_id for single deletion, or delete_all: true to remove all.');

  const listResult = await evaluateAsync(`
    fetch('${BASE}/list_alerts', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) { return (data.r || []).map(function(a) { return a.alert_id; }); })
      .catch(function() { return []; })
  `);
  const ids = listResult || [];
  if (!ids.length) return { success: true, deleted: 0, source: 'rest_api' };

  await evaluate(`window._xhrPayload = { payload: { alert_ids: ${JSON.stringify(ids)} } }`);
  const result = await evaluate(xhrEval('/delete_alerts'));
  return { success: result?.s === 'ok', deleted: ids.length, source: 'rest_api', error: result?.errmsg || null };
}
