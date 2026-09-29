const express = require('express');
const { getTchatFreeModels } = require('@librechat/api');
const { requireJwtAuth } = require('~/server/middleware/');

/**
 * Tchat model facts the stock /api/models response has no room for. Today that
 * is which models TensorGrid prices at zero, for the picker's "Free" tag.
 */
const router = express.Router();

router.get('/free', requireJwtAuth, async (_req, res) => {
  res.json({ free: await getTchatFreeModels() });
});

module.exports = router;
