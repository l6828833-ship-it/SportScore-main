const express = require('express');
const router = express.Router();
const notifyController = require('../controllers/notify');

// Match alerts, for Cloud Scheduler (see controllers/notify.js).
router.post('/tick', notifyController.tick);
router.post('/test', notifyController.test);

module.exports = router;
