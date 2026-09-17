import js from "@eslint/js";
import ts from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import globals from "globals";
export default ts.config(
  {
    ignores: [
      ".tools",
      "dist",
      "node_modules",
      "src-tauri/target",
      "public/assets",
      "test-results",
      "playwright-report",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.worker },
    },
    plugins: { "react-hooks": hooks },
    rules: {
      ...hooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
