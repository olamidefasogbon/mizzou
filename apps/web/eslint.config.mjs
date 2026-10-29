import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Client components must never pull the @mizzou/core root barrel (it
  // builds the Meta client at import time). Browser-safe code lives behind
  // subpath exports: @mizzou/core/voice and @mizzou/core/events. Server
  // files (route handlers, actions, lib, layouts) keep the root import.
  {
    files: ["src/app/**/*.tsx", "src/components/**/*.tsx"],
    ignores: ["src/app/api/**", "src/app/**/layout.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@mizzou/core",
              message:
                "Import browser-safe subpaths instead: '@mizzou/core/voice' or '@mizzou/core/events'. The root barrel builds the Meta client and crashes browser bundles.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
