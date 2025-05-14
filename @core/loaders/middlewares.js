import { join } from "path";
import { readdirSync, existsSync } from "fs";

const Apps = require("./apps");

const middlewares = {
  _initialized: false,
  _initializingPromise: null,

  _map: {},

  load() {
    if (this._initialized) return;

    Apps.getPaths().map((_appPath) => {
      // Load middlewares from the "middlewares" directory
      const middlewaresPath = join(process.cwd(), `${_appPath}/middlewares`);
      let middlewaresFiles = [];
      if (existsSync(middlewaresPath)) {
        middlewaresFiles = readdirSync(middlewaresPath).filter((file) => file.endsWith(".js"));
      }
      for (const file of middlewaresFiles) {
        const { default: middleware } = require(join(middlewaresPath, file));
        if (!middleware) continue;
        // Use the filename (without extension) as the middleware key
        let middlewareName = file.split(".").slice(0, -1).join(".");
        this._map[middlewareName] = typeof middleware === "function" ? { middleware } : middleware;
      }
    });

    this._initialized = true;
  },

  async loadAsync() {
    if (this._initialized) return;

    if (!this._initializingPromise) {
      this._initializingPromise = (async () => {
        console.log("############################################## middlewares.loadAsync");
        this._initialized = true;
      })();
    }

    await this._initializingPromise;
  },

  wrap(middleware, status = 400, message = "Bad request") {
    return async (req, res, next) => {
      try {
        const result = await middleware({ request: req, response: res, next: next });

        // If middleware explicitly returns `false` or an error object, stop and respond
        if (result === false) {
          return res.status(status).json({ error: message });
        } else if (result && typeof result === "object") {
          return res.status(status).json(result);
        }

        // Otherwise, continue
        if (!res.headersSent) next();
      } catch (err) {
        next(err); // Pass error to Express error handler
      }
    };
  },

  getMap() {
    return this._map;
  },

  setMap(newMap) {
    this._map = newMap;
  },

  get(name) {
    return this.wrap(this._map[name]?.middleware || (() => true));
  },

  set(key, value) {
    this._map[key] = value;
  },
};

module.exports = middlewares;
