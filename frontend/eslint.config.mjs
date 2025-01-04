// @ts-check

import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import tailwind from "eslint-plugin-tailwindcss";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import withNuxt from "./.nuxt/eslint.config.mjs";

import { includeIgnoreFile } from "@eslint/compat";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gitignorePath = path.resolve(__dirname, "../.gitignore");

export default withNuxt(
  includeIgnoreFile(gitignorePath),
  { files: ["**/*.{js,mjs,cjs,ts,tsx,vue}"] },
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  // @ts-ignore see https://github.com/nuxt/eslint/issues/497
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  ...tailwind.configs["flat/recommended"],
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  { files: ["**/*.vue"], languageOptions: { parserOptions: { parser: tseslint.parser } } },
  {
    rules: {
      "no-console": 0,
      "no-unused-vars": "off",
      "vue/multi-word-component-names": "off",
      "vue/no-setup-props-destructure": 0,
      "vue/no-multiple-template-root": 0,
      "vue/no-v-model-argument": 0,
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/ban-ts-comment": 0,
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          ignoreRestSiblings: true,
          destructuredArrayIgnorePattern: "_",
          caughtErrors: "none",
        },
      ],

      "prettier/prettier": [
        "warn",
        {
          arrowParens: "avoid",
          semi: true,
          tabWidth: 2,
          useTabs: false,
          vueIndentScriptAndStyle: true,
          singleQuote: false,
          trailingComma: "es5",
          printWidth: 120,
        },
      ],
    },
  }
);
