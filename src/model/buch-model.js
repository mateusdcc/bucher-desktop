function flattenConcepts(concepts) {
  return concepts.flatMap(concept => [concept, ...flattenConcepts(concept.children)]);
}

module.exports = { flattenConcepts };
