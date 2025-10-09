import eslintConfigPrettier from "eslint-config-prettier";

export default [
  {
    ignores: ["node_modules/**", "dist/**", ".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
  // Keep Prettier compatibility (no conflicting formatting rules)
  eslintConfigPrettier,
];
