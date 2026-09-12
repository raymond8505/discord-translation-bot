// Guard around husky's install: production and CI installs have no git
// hooks to manage and, with devDependencies omitted, no husky package either.
if (process.env.NODE_ENV === "production" || process.env.CI === "true" || process.env.HUSKY === "0") {
  process.exit(0);
}
const { default: husky } = await import("husky");
const output = husky();
if (output) console.log(output);
