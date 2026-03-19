import pino from "pino";
import { getConfig } from "../config.js";

let _logger: pino.Logger | null = null;

export function initLogger(): pino.Logger {
  const config = getConfig();
  _logger = pino({
    level: config.LOG_LEVEL,
  });
  return _logger;
}

export function getLogger(): pino.Logger {
  if (!_logger) throw new Error("Logger not initialized. Call initLogger() first.");
  return _logger;
}
