const http = require('node:http');
const fs   = require('node:fs');
const path = require('node:path');
const url  = require('node:url');

const PORT       = 3000;
const DATA_FILE  = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ── Configuration ──────────────────────────────────────────────────────────────
// Change these to your actual book club members' names!
const MEMBERS = [
  'Al',
  'Ashley',
  'Brit',
  'Julie',
  'Katie',
  'Kristen',
  'Kristin',
  'Theresa',
];

// ── Data helpers (JSON file — no database needed) ──────────────────────────────
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ books: [], checkouts: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── Static file server ─────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

function serveFile(res, filePath) {
  try {
    const data = fs.readFileSync(filePath);
    const ext  = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

// ── Request helpers ────────────────────────────────────────────────────────────
function jsonRes(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
  });
}

// ── Server ─────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const { pathname, query } = url.parse(req.url, true);
  const method = req.method;

  // ── API ──────────────────────────────────────────────────────────────────────

  // GET /api/members
  if (pathname === '/api/members' && method === 'GET') {
    return jsonRes(res, MEMBERS);
  }

  // GET /api/books
  if (pathname === '/api/books' && method === 'GET') {
    const { books, checkouts } = loadData();
    const result = books.map(book => {
      const co = checkouts.find(c => c.book_id === book.id && !c.returned_at);
      return { ...book, checked_out_by: co?.member_name || null, checked_out_at: co?.checked_out_at || null };
    });
    return jsonRes(res, result);
  }

  // POST /api/books
  if (pathname === '/api/books' && method === 'POST') {
    const body = await readBody(req);
    if (!body.owner_name || !body.title) return jsonRes(res, { error: 'owner_name and title required' }, 400);
    const data = loadData();
    const book = {
      id:          Date.now(),
      owner_name:  body.owner_name,
      ol_key:      body.ol_key      || null,
      title:       body.title,
      author:      body.author      || 'Unknown Author',
      cover_url:   body.cover_url   || null,
      genre:       body.genre       || null,
      description: body.description || null,
      publish_year: body.publish_year || null,
      added_at:    new Date().toISOString(),
    };
    data.books.unshift(book);
    saveData(data);
    return jsonRes(res, book);
  }

  // DELETE /api/books/:id
  const delMatch = pathname.match(/^\/api\/books\/(\d+)$/);
  if (delMatch && method === 'DELETE') {
    const id   = parseInt(delMatch[1]);
    const body = await readBody(req);
    const data = loadData();
    const book = data.books.find(b => b.id === id);
    if (!book) return jsonRes(res, { error: 'Not found' }, 404);
    if (book.owner_name !== body.member_name) return jsonRes(res, { error: 'Only the owner may remove a tome' }, 403);
    if (data.checkouts.find(c => c.book_id === id && !c.returned_at))
      return jsonRes(res, { error: 'This tome is currently borrowed — it must be returned first' }, 400);
    data.books     = data.books.filter(b => b.id !== id);
    data.checkouts = data.checkouts.filter(c => c.book_id !== id);
    saveData(data);
    return jsonRes(res, { success: true });
  }

  // POST /api/books/:id/checkout
  const coMatch = pathname.match(/^\/api\/books\/(\d+)\/checkout$/);
  if (coMatch && method === 'POST') {
    const id   = parseInt(coMatch[1]);
    const body = await readBody(req);
    const data = loadData();
    const book = data.books.find(b => b.id === id);
    if (!book) return jsonRes(res, { error: 'Not found' }, 404);
    if (book.owner_name === body.member_name) return jsonRes(res, { error: 'You cannot borrow your own tome' }, 400);
    if (data.checkouts.find(c => c.book_id === id && !c.returned_at))
      return jsonRes(res, { error: 'This tome is already borrowed' }, 400);
    data.checkouts.push({ id: Date.now(), book_id: id, member_name: body.member_name, checked_out_at: new Date().toISOString(), returned_at: null });
    saveData(data);
    return jsonRes(res, { success: true });
  }

  // POST /api/books/:id/return
  const retMatch = pathname.match(/^\/api\/books\/(\d+)\/return$/);
  if (retMatch && method === 'POST') {
    const id   = parseInt(retMatch[1]);
    const body = await readBody(req);
    const data = loadData();
    const co   = data.checkouts.find(c => c.book_id === id && !c.returned_at);
    if (!co) return jsonRes(res, { error: 'No active borrowing found' }, 404);
    if (co.member_name !== body.member_name) return jsonRes(res, { error: 'This tome was borrowed by someone else' }, 403);
    co.returned_at = new Date().toISOString();
    saveData(data);
    return jsonRes(res, { success: true });
  }

  // GET /api/search  (Google Books, falls back to Open Library)
  if (pathname === '/api/search' && method === 'GET') {
    const q = (query.q || '').trim();
    if (!q) return jsonRes(res, []);

    // ── Try Google Books first ──────────────────────────────────────────────
    try {
      const url  = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=10&printType=books`;
      console.log('[search] Google Books →', url);
      const r    = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const json = await r.json();
      console.log('[search] Google Books status:', r.status, '| items:', json.items?.length ?? 0);
      if (json.items?.length) {
        return jsonRes(res, json.items.map(item => {
          const info  = item.volumeInfo || {};
          let cover   = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || null;
          if (cover) cover = cover.replace('http://', 'https://');
          return {
            key:          item.id,
            title:        info.title || 'Unknown Title',
            author:       info.authors?.[0] || 'Unknown Author',
            cover_url:    cover,
            publish_year: info.publishedDate ? info.publishedDate.substring(0, 4) : null,
            genre:        info.categories   ? info.categories.slice(0, 2).join(', ') : null,
            description:  info.description  ? info.description.substring(0, 500)    : null,
          };
        }));
      }
    } catch (e) {
      console.error('[search] Google Books failed:', e.message);
    }

    // ── Fall back to Open Library ───────────────────────────────────────────
    try {
      const url  = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=10&fields=key,title,author_name,cover_i,first_publish_year,subject`;
      console.log('[search] Open Library fallback →', url);
      const r    = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const json = await r.json();
      console.log('[search] Open Library status:', r.status, '| docs:', json.docs?.length ?? 0);
      return jsonRes(res, (json.docs || []).map(d => ({
        key:          d.key || null,
        title:        d.title,
        author:       d.author_name?.[0] || 'Unknown Author',
        cover_url:    d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
        publish_year: d.first_publish_year ? String(d.first_publish_year) : null,
        genre:        d.subject ? d.subject.slice(0, 3).join(', ') : null,
        description:  null,
      })));
    } catch (e) {
      console.error('[search] Open Library failed:', e.message);
      return jsonRes(res, { error: 'Search unavailable — both sources failed' }, 500);
    }
  }

  // ── Static files ─────────────────────────────────────────────────────────────
  const safePath = pathname === '/' ? '/index.html' : pathname;
  serveFile(res, path.join(PUBLIC_DIR, safePath));
});

server.listen(PORT, () => {
  console.log(`\n📚 The Book Clerb is open!\n   Visit: http://localhost:${PORT}\n`);
  console.log(`   Members: ${MEMBERS.join(', ')}`);
  console.log(`   (Edit the MEMBERS array in server.js to change names)\n`);
});
