const http = require("http");
const https = require("https");

const config = require("@bootloader/config");
const utils = require("@bootloader/utils");
const log4js = require("@bootloader/log4js");
const fs = require("fs");
const LOGGER = log4js.getLogger("core");

const Apps = require("./loaders/apps");
const Middlewares = require("./loaders/middlewares");
const { loadApp } = require("./router");
const { initJobs } = require("./jobs");
const coreutils = require("./utils/coreutils");

const DEFAULT_APP = "default";
const APP = (function (app) {
  if (app.indexOf("app-") >= 0) {
    return app.replace("app-", "");
  }
  return app;
})(process.env.APP || DEFAULT_APP);
utils.context.init();

function BootLoader(...args) {
  let mappings = [];
  let options = { name: DEFAULT_APP, context: "/", path: "app" };
  let app = null;

  this.map = function (o) {
    o.name = o.name || DEFAULT_APP;
    o.path = o.path || coreutils.getAppPath(o.name);
    o.include = coreutils.toArray(o.include || []);
    mappings.push(o);
    return this;
  };

  for (let arg of args) {
    this.map(arg);
  }

  this.init = async function () {
    this.$init = new Promise((resolve) => {
      utils.context.init(() => {
        LOGGER.info("===================INIT");
        resolve(this);
      });
    });
    return this.$init;
  };

  this.create = function (onCreate) {
    utils.context.init({ tenant: "CRT" }, () => {
      options =
        mappings.filter(function (arg) {
          return arg.name == APP;
        })[0] || options;
      let { name = "default", path, context, include } = options;

      coreutils.options(options);
      coreutils.log(`Creating on ${context}`);

      Apps.load(options);
      Middlewares.load();

      app = require(`./../${path}/app.js`);
      app.use(Middlewares.get("ContextParser"));
      app.use(utils.context.withRequest());
      loadApp({ name: name, context: context, app, path });

      if (onCreate && typeof onCreate == "function") onCreate({ ...options, app });
    });
    return this;
  };

  this.launch = function (onLaunch) {
    utils.context.init({ tenant: "LNC" }, () => {
      let port = process.env.PORT || config.get("server.port");

      //Create a server
      var server = null;
      let sslPort = config.getIfPresent("server.ssl.port") || null;
      let sslKey = config.getIfPresent("server.ssl.key") || null;
      let sslCert = config.getIfPresent("server.ssl.cert") || null;
      if (sslPort && sslKey && sslCert) {
        server = https.createServer(
          {
            key: fs.readFileSync(sslKey),
            cert: fs.readFileSync(sslCert),
          },
          app
        );
        port = sslPort;
      } else {
        server = http.createServer(app);
      }
      console.log(`APP[${options.name}]: Launching on ${port}:/${options.context}`);
      //Lets start our server
      server.listen(port, function () {
        //console.log("NGROK_URL",config.getIfPresent("NGROK_URL"))
        //console.log("ngrok.url",config.store("ngrok").url)
        //Callback triggered when server is successfully listening. Hurray!
        coreutils.log(`Listening on http://localhost:${port}${options.context}`);
        //noway.emit('noway.started', null)
        if (onLaunch && typeof onLaunch == "function") onLaunch({ ...options, app, server, config });
      });
    });
    return this;
  };

  this.initJobs = function () {
    utils.context.init({ tenant: "JBS" }, async () => {
      try {
        let initd = await initJobs(options);
        if (initd) {
          LOGGER.info("JOBS : initd");
        }
      } catch (e) {
        LOGGER.info("JOBS : Not initd");
      }
    });
    return this;
  };
}

// Prevent crashes due to unhandled promise rejections
process.on("unhandledRejection", (err) => {
  LOGGER.error("🔥 Unhandled Promise Rejection:", err);
});

// Prevent crashes due to uncaught exceptions
process.on("uncaughtException", (err) => {
  LOGGER.error("💥 Uncaught Exception:", err);
});

module.exports = {
  BootLoader,
};
