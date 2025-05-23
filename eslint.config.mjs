import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["*.config.mjs"]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    //ignores: ["example/babel.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      parser: tseslint.parser,
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "no-unused-vars": "off",
      indent: "off", // prettier handles this
      "linebreak-style": ["error", "unix"],
      quotes: ["warn", "double", { avoidEscape: true }],
      semi: ["error", "always"],
      "prefer-const": "error",
      "@typescript-eslint/no-explicit-any": "off",
      curly: ["error", "all"],
      "@typescript-eslint/explicit-function-return-type": ["error", { allowExpressions: true }],
      "@typescript-eslint/no-unused-vars": "error",
      eqeqeq: ["error", "always"],
      "@typescript-eslint/explicit-member-accessibility": "error",
    },
  },
]);
