const source = require('../utils/source');
const genericHandler = require('../utils/genericHandler');

/**
 * Only 365scores has a search. The other sources are listed explicitly rather
 * than left to `source.pick`'s fallback, which would answer with 365scores ids
 * that mean nothing to the rest of a server running another source.
 */
const notSupported = async () => {
  const error = new Error(
    'Search is only available from the 365scores source.',
  );
  error.status = 501;
  throw error;
};
const unsupported = { search: notSupported };

const searchModel = source.pick({
  '365scores': require('../services/scores365/search'),
  livescore: unsupported,
  scrape: unsupported,
  espn: unsupported,
  apifootball: unsupported,
});

// http://localhost:3000/search?q=real&lang=en
const search = (req, res) =>
  genericHandler(searchModel.search, req, res, 'Failed to search');

module.exports = { search };
