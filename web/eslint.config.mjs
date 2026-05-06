import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "out/**",
      "out-emwaver/**",
      "node_modules/**",
      "next-env.d.ts",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
  {
    files: ["app/emwaver/**", "components/emwaver/**", "lib/emwaver/**"],
    rules: {
      "@next/next/no-img-element": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "react-hooks/set-state-in-effect": "off",
      "react/no-unescaped-entities": "off",
    },
  },
];

export default eslintConfig;
