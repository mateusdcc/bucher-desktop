// Explicit finite numeric orders sort before legacy siblings. Equal ranks and
// unranked notes use the catalog's original natural-name comparator; exact
// name ties retain their input order.
function sortConcepts(app, siblings) {
  return siblings.map((concept, index) => {
    const value = app.metadataCache.getFileCache(concept.file)?.frontmatter?.order;
    return { concept, index, order: typeof value === 'number' && Number.isFinite(value) ? value : null };
  }).sort((a, b) => {
    if (a.order !== null && b.order === null) return -1;
    if (a.order === null && b.order !== null) return 1;
    if (a.order !== null && b.order !== null && a.order !== b.order) return a.order < b.order ? -1 : 1;
    return a.concept.name.localeCompare(b.concept.name, undefined, { sensitivity: 'base', numeric: true }) || a.index - b.index;
  }).map(item => item.concept);
}

module.exports = { sortConcepts };
