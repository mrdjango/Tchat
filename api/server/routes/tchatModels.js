const express = require('express');
const { getTchatModelCatalog } = require('@librechat/api');
const { requireJwtAuth } = require('~/server/middleware/');

/**
 * Tchat model facts the stock /api/models response has no room for: which
 * models TensorGrid prices at zero, and each model's category, so the picker
 * offers only chat models as chat models.
 */
const router = express.Router();

router.get('/catalog', requireJwtAuth, async (_req, res) => {
  res.json(await getTchatModelCatalog());
});

module.exports = router;
