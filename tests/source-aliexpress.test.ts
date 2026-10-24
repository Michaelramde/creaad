import assert from "node:assert/strict";
import { test } from "node:test";

import { extractJsonArray, parseSearchItems } from "../src/lib/providers/aliexpress-http.ts";

test("extraction d'un tableau JSON équilibré", () => {
  const source = 'avant [1,2,[3,4]] après';
  const at = source.indexOf("[");
  assert.equal(extractJsonArray(source, at), "[1,2,[3,4]]");
});

test("les crochets dans une chaîne ne cassent pas l'extraction", () => {
  const source = 'x [{"t":"sérum [30ml]"},{"t":"b"}] y';
  const at = source.indexOf("[");
  assert.equal(extractJsonArray(source, at), '[{"t":"sérum [30ml]"},{"t":"b"}]');
});

test("un tableau non fermé renvoie null plutôt qu'un objet partiel", () => {
  assert.equal(extractJsonArray("x [1,2", 2), null);
});

test("parseSearchItems lit les produits de la page de recherche", () => {
  const html = `<script>{"itemList":{"content":[
    {"productId":"1005001","title":{"displayTitle":"Sérum Vitamine C 30ml"},"image":{"imgUrl":"//cdn.test/a.jpg"},"prices":{"salePrice":{"formattedPrice":"US $3.50"}}},
    {"productId":"1005002","title":{"displayTitle":"Autre produit"}}
  ]},"fin":true}</script>`;

  const items = parseSearchItems(html);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.productId, "1005001");
  assert.equal(items[0]?.title?.displayTitle, "Sérum Vitamine C 30ml");
  assert.equal(items[0]?.image?.imgUrl, "//cdn.test/a.jpg");
});

test("une page sans itemList ne produit aucun candidat", () => {
  assert.deepEqual(parseSearchItems("<html>page anti-bot</html>"), []);
});

test("un JSON malformé ne fait pas planter", () => {
  assert.deepEqual(parseSearchItems('{"itemList":{"content":[ oops ]}'), []);
});
