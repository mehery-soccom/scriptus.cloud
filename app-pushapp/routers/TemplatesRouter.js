const express = require("express");

const router = express.Router();

router.route(`/status`).get(async (req, res, next) => {
  res.send("OK");
});

module.exports = {
  path: "/api/templates",
  router: router,
};
