/**
 * Core alert logic — uses TradingView pricealerts REST API via synchronous XHR.
 * text/plain Content-Type avoids CORS preflight while still sending JSON body.
 */
import { evaluate, evaluateAsync, getClient } from '../connection.js';

const BASE = 'https://pricealerts.tradingview.com';

// Map condition strings to TradingView API condition types.
// 'greater'/'less' are true static conditions — verified live 2026-07-07: an alert
// created with type 'greater' at a level price was already above fired within
// 2 seconds. The cross_* types only fire when price crosses the level.
const CONDITION_MAP = {
  greater_than: 'greater',
  less_than:    'less',
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
  // Read active chart context: symbol, resolution, currency, session.
  // symbolInfo() lives on chartModel().mainSeries() (not on the chart facade).
  const ctx = await evaluate(`
    (function() {
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        var out = { symbol: chart.symbol() };
        try { out.resolution = chart.resolution(); } catch(e) {}
        try {
          var si = chart.chartModel().mainSeries().symbolInfo();
          if (si) { out.currency = si.currency_code; out.session = si.subsession_id; }
        } catch(e) {}
        return out;
      } catch(e) { return null; }
    })()
  `);

  if (!symbol) {
    symbol = ctx?.symbol || null;
    if (!symbol) return { success: false, error: 'Could not determine active chart symbol. Pass symbol explicitly.', source: 'rest_api' };
  }

  // Chart-derived currency/session/resolution only apply when the alert targets the
  // chart's own symbol; for an explicit different symbol fall back to safe defaults.
  const onChartSymbol = !ctx?.symbol || symbol === ctx.symbol || ctx.symbol.endsWith(':' + symbol);
  const currency = (onChartSymbol && ctx?.currency) || 'USD';
  const session = (onChartSymbol && ctx?.session) || 'extended';
  const resolution = (onChartSymbol && ctx?.resolution) || '1';

  const tvCondition = CONDITION_MAP[condition] || 'cross';
  const payload = {
    conditions: [{
      type: tvCondition,
      frequency: 'on_first_fire',
      series: [{ type: 'barset' }, { type: 'value', value: Number(price) }],
      resolution,
    }],
    symbol: `={"adjustment":"splits","currency-id":${JSON.stringify(currency)},"session":${JSON.stringify(session)},"symbol":${JSON.stringify(symbol)}}`,
    resolution,
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
    resolution,
    currency,
    session,
    message: payload.message,
    error: result?.errmsg || null,
    source: 'rest_api',
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
