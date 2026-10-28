// Reads a collection as the app stores it. Documents get their text back from
// contents/<id>.md (see electron/store.cjs), so tests see whole documents.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const contentFile = (dataDir, id) =>
  path.join(
    dataDir,
    'contents',
    /^[A-Za-z0-9_-]{1,100}$/.test(id) ? `${id}.md` : `h-${crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 32)}.md`
  );

function readCollection(dataDir, name) {
  const value = JSON.parse(fs.readFileSync(path.join(dataDir, name + '.json'), 'utf8'));
  if (name !== 'documents') return value;
  return value.map((d) => (typeof d.content === 'string' ? d : { ...d, content: fs.readFileSync(contentFile(dataDir, d.id), 'utf8') }));
}

module.exports = { readCollection, contentFile };
