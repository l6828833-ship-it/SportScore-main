/**
 * Competition list for the 365scores source.
 *
 * Returns the competitions this server maps to stable API-Football ids (the
 * pinned popular set: World Cup, the European cups, the big five, every wired
 * Arab league, MLS), each in the API-Football-shaped envelope. Names and
 * country come from 365scores' live catalogue; the id exposed is the
 * API-Football one the rest of the app expects.
 */

const client = require('../../utils/scores365/client');
const nz = require('../../utils/scores365/normalize');
const {
  TO_API_FOOTBALL,
  toExposedId,
} = require('../../utils/scores365/leagues');

const isCupName = (name) =>
  /cup|champions|europa|conference|world|libertadores|nations/i.test(
    name || ''
  );

const getLeagues = async () => {
  let catalogue = [];
  let countries = [];
  try {
    const body = await client.competitions();
    catalogue = body.competitions || [];
    countries = body.countries || [];
  } catch {
    catalogue = [];
  }

  const byId = new Map(catalogue.map((c) => [c.id, c]));
  const countryById = new Map(countries.map((c) => [c.id, c]));

  const out = [];
  for (const [scores365Id] of TO_API_FOOTBALL) {
    const c = byId.get(scores365Id);
    const name = c ? c.name : null;
    const country = c ? countryById.get(c.countryId) : null;
    out.push({
      league: {
        id: toExposedId(scores365Id),
        name,
        type: isCupName(name) ? 'Cup' : 'League',
        logo: nz.competitionLogo(scores365Id),
      },
      country: {
        name: country ? country.name : null,
        code: null,
        flag: null,
      },
      seasons: [],
    });
  }

  return out;
};

module.exports = { getLeagues };
