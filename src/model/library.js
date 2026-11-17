const { frontmatter, metadata } = require('./metadata');

const directory = path => path.slice(0, path.lastIndexOf('/'));
const basename = path => path.split('/').at(-1);
const fold = value => value.normalize('NFC').toLowerCase();

function normalize(path) {
  const parts = [];
  for (const part of path.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/** Adapt the standalone file commands to the catalog, learning, and progress models. */
function createLibrary(write, discard) {
  const files = new Map();
  let basePath = '';
  function ensureFolder(path) {
    if (files.has(path)) return files.get(path);
    const parent = path.includes('/') ? ensureFolder(directory(path)) : null;
    const folder = { name: basename(path), path, children: [] };
    files.set(path, folder);
    parent?.children.push(folder);
    return folder;
  }
  function upsert(path, source) {
    const file = files.get(path);
    if (file) {
      file.source = source;
      file.frontmatter = source === null ? null : frontmatter(source);
      return file;
    }
    const created = { name: basename(path), path, source, frontmatter: source === null ? null : frontmatter(source), extension: path.split('.').at(-1).toLowerCase() };
    ensureFolder(directory(path)).children.push(created);
    files.set(path, created);
    return created;
  }
  function load(result) {
    basePath = result.basePath;
    files.clear();
    ensureFolder('Buches');
    for (const entry of result.entries) upsert(entry.path, entry.source);
  }
  function resolve(raw, from) {
    let link = raw;
    try { link = decodeURIComponent(link); } catch {}
    const prefix = from.split('/').slice(0, 2).join('/');
    const paths = [link, normalize(directory(from) + '/' + link), normalize(prefix + '/' + link)];
    const matches = path => [path, path + '.md'].flatMap(candidate => {
      const file = files.get(candidate);
      return file && !file.children ? [file] : [];
    });
    for (const path of paths) {
      const found = matches(path)[0];
      if (found) return found;
    }
    if (!link || link.startsWith('.') || link.includes('/')) return null;
    const local = [...files.values()].filter(file => file.path.startsWith(prefix + '/') && !file.children
      && [file.name, file.name.replace(/\.md$/i, '')].some(name => fold(name) === fold(link)));
    return local.length === 1 ? local[0] : null;
  }

  const vault = {
    getAbstractFileByPath: path => files.get(path),
    read: async file => file.source,
    cachedRead: async file => file.source,
    createFolder: async path => ensureFolder(path),
    create: async (path, text) => {
      await write(path, text, null);
      return upsert(path, text);
    },
    process: async (file, transform) => {
      const expected = file.source;
      const text = transform(expected);
      if (text !== expected) {
        await write(file.path, text, expected);
        upsert(file.path, text);
      }
      return text;
    },
    delete: async file => {
      await discard(file.path, file.source);
      const siblings = files.get(directory(file.path)).children;
      siblings.splice(siblings.indexOf(file), 1);
      files.delete(file.path);
    },
  };
  const app = {
    vault,
    workspace: { getLeavesOfType: () => [] },
    metadataCache: {
      getFileCache: file => ({ frontmatter: file.frontmatter }),
      getFirstLinkpathDest: resolve,
      computeMetadataAsync: async bytes => metadata(new TextDecoder().decode(bytes)),
    },
  };
  return { app, load, resolve, file: vault.getAbstractFileByPath, get basePath() { return basePath; } };
}

module.exports = { createLibrary };
