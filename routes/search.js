const express = require('express');
const router = express.Router();
const searchController = require('../controllers/search');

// Teams and competitions by name: /search?q=real&lang=en
router.get('/', searchController.search);

module.exports = router;
