import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Config ESLint Patrimo.
 * Hooks React 19 actifs (set-state-in-effect, refs) — corrigés dans fix/eslint-hooks-effects.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // TanStack Table : warning bruyant du React Compiler (pas un bug app)
      "react-hooks/incompatible-library": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Outils hors runtime app
    "scripts/**",
    "e2e/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
