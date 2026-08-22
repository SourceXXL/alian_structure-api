import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "src/graphql/schema.graphql",
  documents: "src/graphql/client/operations.graphql",
  generates: {
    "src/graphql/client/generated.ts": {
      plugins: ["typescript", "typescript-operations", "typed-document-node"],
      config: {
        enumsAsTypes: true,
        immutableTypes: true,
        scalars: {
          DateTime: {
            input: "string",
            output: "string",
          },
        },
      },
    },
  },
};

export default config;
