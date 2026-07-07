import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/alerts.js';

export function registerAlertTools(server) {
  server.tool('alert_create', 'Create a price alert via the TradingView pricealerts REST API. Resolution, currency and session are taken from the active chart when the alert targets its symbol.', {
    condition: z.string().describe('Alert condition: "greater_than"/"less_than" (static — fires immediately if price is already beyond the level), "crossing", "cross_up", "cross_down"'),
    price: z.coerce.number().describe('Price level for the alert'),
    message: z.string().optional().describe('Alert message'),
    symbol: z.string().optional().describe('Symbol to set the alert on (e.g., "NVDA"). Defaults to the active chart symbol.'),
  }, async ({ condition, price, message, symbol }) => {
    try { return jsonResult(await core.create({ condition, price, message, symbol })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('alert_list', 'List active alerts, optionally filtered by symbol', {
    symbol: z.string().optional().describe('Filter alerts by symbol (e.g., "NVDA"). Case-insensitive.'),
  }, async ({ symbol } = {}) => {
    try { return jsonResult(await core.list({ symbol })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('alert_delete', 'Delete a single alert by ID, or delete all alerts', {
    alert_id: z.coerce.number().optional().describe('Alert ID to delete (from alert_list)'),
    delete_all: z.coerce.boolean().optional().describe('Delete all alerts'),
  }, async ({ alert_id, delete_all }) => {
    try {
      if (alert_id) return jsonResult(await core.deleteById(alert_id));
      return jsonResult(await core.deleteAlerts({ delete_all }));
    }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
