const express = require('express');
const axios = require('axios');

/**
 * Team crests, competition logos and player photos, served from this server.
 *
 *   GET /img/team/:id.png    GET /img/league/:id.png    GET /img/player/:id.png
 *
 * The apps and the website load every picture from here, never from the data
 * provider's CDN. The first request for a picture fetches it upstream; after
 * that it comes from memory, and the long Cache-Control lets phones and the
 * website keep it for weeks.
 */

const router = express.Router();

const UPSTREAM =
  process.env.IMAGE_UPSTREAM ||
  'https://imagecache.365scores.com/image/upload/f_png,w_80,h_80,c_limit,q_auto:eco,dpr_2/v1';

const KINDS = { team: 'Competitors', league: 'Competitions', player: 'Athletes' };

// Crests are a few KB each; ~3000 of them stay well under 64 MB.
const MAX_ENTRIES = Number(process.env.IMAGE_CACHE_ENTRIES) || 3000;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const cache = new Map(); // key -> { body, type, at }
const pending = new Map(); // key -> Promise, so one picture is fetched once

function remember(key, entry) {
  cache.delete(key);
  cache.set(key, entry);
  // Map keeps insertion order: the first key is the least recently used.
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

async function fetchUpstream(kind, id) {
  const response = await axios.get(`${UPSTREAM}/${KINDS[kind]}/${id}`, {
    responseType: 'arraybuffer',
    timeout: 8000,
    headers: { 'User-Agent': 'Mozilla/5.0' },
    validateStatus: (s) => s === 200,
  });
  const type = String(response.headers['content-type'] || 'image/png');
  if (!type.startsWith('image/')) throw new Error('not an image');
  return { body: Buffer.from(response.data), type, at: Date.now() };
}

router.get('/:kind/:file', async (req, res) => {
  const { kind } = req.params;
  const match = /^(\d{1,10})(\.png)?$/.exec(req.params.file);
  if (!KINDS[kind] || !match) return res.status(404).end();
  const id = match[1];
  const key = `${kind}/${id}`;

  let entry = cache.get(key);
  if (entry && Date.now() - entry.at < TTL_MS) {
    remember(key, entry);
  } else {
    try {
      if (!pending.has(key)) {
        pending.set(
          key,
          fetchUpstream(kind, id).finally(() => pending.delete(key)),
        );
      }
      entry = await pending.get(key);
      remember(key, entry);
    } catch (error) {
      // A stale copy beats a broken picture.
      if (!entry) {
        res.set('Cache-Control', 'public, max-age=300');
        return res.status(404).end();
      }
    }
  }

  res.set({
    'Content-Type': entry.type,
    'Cache-Control': 'public, max-age=2592000, stale-while-revalidate=604800',
    'Content-Length': entry.body.length,
  });
  res.send(entry.body);
});

module.exports = router;
