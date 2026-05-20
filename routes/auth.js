'use strict';
const express = require('express');
const router = express.Router();

router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.BRAIN_PASSWORD) {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

module.exports = router;
