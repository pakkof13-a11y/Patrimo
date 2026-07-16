import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Config ESLint Patrimo.
 *
 * `react-hooks/set-state-in-effect` (React 19 / eslint-plugin-react-hooks récent)
 * signale en erreur de nombreux patterns légitimes Next.js :
 * - hydratation client (theme, localStorage, data-hydrated e2e)
 * - sync prop → state de formulaire / pagination
 * - chargement initial via fetch dans un effet
 *
 * On le désactive globalement : les refactors un par un sont hors scope lint
 * et casseraient plus qu’ils n’aideraient. Les autres règles hooks restent actives.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      // Mise à jour de ref.current pour exposer la devise au timer prix : pattern courant
      "react-hooks/refs": "off",
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
