// Boston Immobilier — MLS API (Vercel Serverless Function)
// Reads local IDX files and returns JSON to the carousel
const fs   = require('fs');
const path = require('path');

const BOSTON_ZIPS = {
  '02108':'Beacon Hill','02109':'North End','02110':'Downtown',
  '02111':'Chinatown','02113':'North End','02114':'Beacon Hill',
  '02115':'Fenway','02116':'Back Bay','02118':'South End',
  '02119':'Roxbury','02120':'Mission Hill','02121':'Dorchester',
  '02122':'Dorchester','02124':'Dorchester','02125':'Dorchester',
  '02126':'Mattapan','02127':'South Boston','02128':'East Boston',
  '02129':'Charlestown','02130':'Jamaica Plain','02131':'Roslindale',
  '02132':'West Roxbury','02134':'Allston','02135':'Brighton',
  '02136':'Hyde Park','02138':'Cambridge','02139':'Cambridge',
  '02140':'Cambridge','02141':'East Cambridge','02142':'Kendall Square',
  '02143':'Somerville','02144':'Somerville','02145':'Somerville',
  '02210':'Seaport','02215':'Fenway','02446':'Brookline',
  '02447':'Brookline','02467':'Chestnut Hill',
};

const TYPE_LABELS = { SF:'Maison', CC:'Condo', MF:'Multi-Familiale' };
const FILES       = { SF:'idx_sf.txt', CC:'idx_cc.txt', MF:'idx_mf.txt' };

function parseIDX(type, opts = {}) {
  const filePath = path.join(process.cwd(), FILES[type]);
  if (!fs.existsSync(filePath)) return [];

  const raw     = fs.readFileSync(filePath, 'utf8');
  const lines   = raw.split('\n');
  const headers = lines[0].split('|').map(h => h.trim());
  const idx     = {};
  headers.forEach((h, i) => idx[h] = i);

  const get = (parts, field) => {
    if (idx[field] === undefined) return '';
    return (parts[idx[field]] || '').replace(/^"|"$/g, '').trim();
  };

  const out = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split('|');

    const status = get(parts, 'STATUS');
    if (!['ACT','NEW','BOM','RAC'].includes(status)) continue;

    const price = parseInt(get(parts, 'LIST_PRICE')) || 0;
    if (opts.minPrice && price < opts.minPrice) continue;
    if (opts.maxPrice && price > opts.maxPrice) continue;

    const zip = get(parts, 'ZIP_CODE');
    if (!BOSTON_ZIPS[zip]) continue;

    const beds = parseInt(get(parts, 'NO_BEDROOMS')) || 0;
    if (opts.minBeds && beds < opts.minBeds) continue;

    const mls    = get(parts, 'LIST_NO');
    const photos = parseInt(get(parts, 'PHOTO_COUNT')) || 0;
    const hood   = BOSTON_ZIPS[zip] || 'Boston';

    out.push({
      mls_no:        mls,
      prop_type:     type,
      type_label:    TYPE_LABELS[type] || 'Propriété',
      status,
      price,
      price_fmt:     '$' + price.toLocaleString('en-US'),
      address:       (get(parts,'STREET_NO') + ' ' + get(parts,'STREET_NAME')).trim(),
      unit:          get(parts,'UNIT_NO'),
      zip,
      neighbourhood: hood,
      bedrooms:      beds,
      baths_full:    parseInt(get(parts,'NO_FULL_BATHS')) || 0,
      baths_half:    parseInt(get(parts,'NO_HALF_BATHS')) || 0,
      sqft:          parseInt(get(parts,'SQUARE_FEET'))   || 0,
      no_units:      parseInt(get(parts,'NO_UNITS'))      || 0,
      year_built:    get(parts,'YEAR_BUILT'),
      photo_count:   photos,
      photo_main:    photos > 0 ? `https://media.mlspin.com/photo.aspx?mls=${mls}&n=0&w=600&h=450` : null,
      photos:        Array.from({length: Math.min(photos,6)}, (_,n) =>
                       `https://media.mlspin.com/photo.aspx?mls=${mls}&n=${n}&w=600&h=450`),
      remarks:       get(parts,'REMARKS').slice(0, 300),
      photo_date:    get(parts,'PHOTO_DATE'),
      list_agent:    get(parts,'LIST_AGENT'),
    });
  }

  return out;
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=3600');

  const type     = (req.query.type || 'CC').toUpperCase();
  const limit    = Math.min(parseInt(req.query.limit)    || 12, 50);
  const offset   = parseInt(req.query.offset)  || 0;
  const minPrice = parseInt(req.query.min_price) || 0;
  const maxPrice = parseInt(req.query.max_price) || 99999999;
  const minBeds  = parseInt(req.query.beds)      || 0;
  const sort     = req.query.sort || 'price_desc';

  const types   = type === 'ALL' ? ['SF','CC','MF'] : [type];
  const valid   = types.filter(t => FILES[t]);

  if (!valid.length) {
    return res.status(400).json({ error: 'Invalid type. Use SF, CC, MF or ALL.' });
  }

  let all = [];
  for (const t of valid) {
    all = all.concat(parseIDX(t, { minPrice, maxPrice, minBeds }));
  }

  // Sort
  all.sort((a, b) => {
    if (sort === 'price_asc') return a.price - b.price;
    if (sort === 'newest')    return b.photo_date.localeCompare(a.photo_date);
    return b.price - a.price;
  });

  // Neighbourhood stats
  const hoods = {};
  all.forEach(l => { hoods[l.neighbourhood] = (hoods[l.neighbourhood] || 0) + 1; });

  res.status(200).json({
    success:        true,
    type,
    total:          all.length,
    limit,
    offset,
    sort,
    neighbourhoods: Object.fromEntries(
      Object.entries(hoods).sort((a,b) => b[1]-a[1]).slice(0,10)
    ),
    listings: all.slice(offset, offset + limit),
  });
};
