import { parseDimensions } from "../src/lib/products/parse-facts.ts";

for (const text of ["25 x 18 x 8 cm", "300×200×100 mm", "25x18x8cm", "Dimensions: 25 x 18 x 8 cm"]) {
  console.log(text.padEnd(28), JSON.stringify(parseDimensions([text])));
}
