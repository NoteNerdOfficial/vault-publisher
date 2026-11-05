// The lint the Obsidian plugin review runs, so its findings are reproducible
// here instead of arriving as a review comment.
//
// `projectService` turns on the type-aware rules, which is what catches the
// `no-unsafe-*` family: those need to know that a value is `any`, and that is
// a question only the type checker can answer. It applies to the tests too,
// because several obsidianmd rules are themselves type-aware and error out
// rather than skip a file they cannot type.
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
  // Only what ships is linted. esbuild bundles `src/main.ts` alone, so the
  // tests and the obsidian stub are not part of the plugin and the review
  // never reads them.
  {
    ignores: [
      "main.js",
      "node_modules/**",
      "examples/**",
      "scripts/**",
      "*.mjs",
      "src/**/*.test.ts",
      "test/**",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },

  // Two rules are off, with the reasons here rather than in a comment at each
  // of the 62 places they fired. Both are off in the config rather than by an
  // inline directive on purpose: a decision about a rule belongs where the
  // rules are, where it can be reconsidered in one place.
  {
    files: ["**/*.ts"],
    rules: {
      // Wants product names and literals lower-cased. Its 32 findings here
      // were all of that kind: `Vault publisher` for the plugin's own name,
      // `Gh-pages` for the branch, `GitHub enterprise` for the product,
      // `HTTPS://GitHub.com/you/repo` for a placeholder URL, `GitHub_pat_…`
      // for the prefix a token actually starts with, and `Yourname` for a
      // placeholder. Applying it would make the interface wrong in order to
      // make the lint quiet. Obsidian's own review did not report these.
      "obsidianmd/ui/sentence-case": "off",
    },
  },
  {
    // The site builder, which is the one part of this plugin that does not
    // build Obsidian's interface.
    files: ["src/publish/**/*.ts"],
    rules: {
      // `createEl` is for building the app's own UI, where the question of
      // which window an element belongs to is live. These modules assemble
      // the *published site* into a document they were handed, and they
      // already say which document: `doc.createElement(...)`. The rule's
      // suggested form, `doc.win.createEl(...)`, reaches back out to a window
      // to make a node for a document it already has, which is further from
      // the intent and not nearer to it.
      "obsidianmd/prefer-create-el": "off",
    },
  },
);
