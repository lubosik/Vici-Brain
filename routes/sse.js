'use strict';
const express = require('express');

module.exports = function(sseClients) {
  const router = express.Router();
  router.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    sseClients.add(res);
    const ping = setInterval(() => {
      try { res.write(':ping\n\n'); } catch {}
    }, 25000);
    req.on('close', () => {
      clearInterval(ping);
      sseClients.delete(res);
    });
  });
  return router;
};
