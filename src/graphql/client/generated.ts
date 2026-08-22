/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> =
  | T
  | {
      [P in keyof T]?: P extends " $fragmentName" | "__typename" ? T[P] : never;
    };
import { TypedDocumentNode as DocumentNode } from "@graphql-typed-document-node/core";
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
  /** An RFC 3339 timestamp. */
  DateTime: { input: string; output: string };
};

export type AgentRating = {
  readonly __typename?: "AgentRating";
  readonly agentId: Scalars["ID"]["output"];
  readonly averageRating: Scalars["Float"]["output"];
  readonly ratingDistribution: ReadonlyArray<RatingCount>;
  readonly totalReviews: Scalars["Int"]["output"];
};

export type AgentReview = {
  readonly __typename?: "AgentReview";
  readonly agentId: Scalars["ID"]["output"];
  readonly author?: Maybe<UserSummary>;
  readonly createdAt: Scalars["DateTime"]["output"];
  readonly developerRespondedAt?: Maybe<Scalars["DateTime"]["output"]>;
  readonly developerResponse?: Maybe<Scalars["String"]["output"]>;
  readonly id: Scalars["ID"]["output"];
  readonly rating: Scalars["Int"]["output"];
  readonly reviewText?: Maybe<Scalars["String"]["output"]>;
  readonly updatedAt: Scalars["DateTime"]["output"];
};

export type AgentReviewConnection = {
  readonly __typename?: "AgentReviewConnection";
  readonly edges: ReadonlyArray<AgentReviewEdge>;
  readonly pageInfo: PageInfo;
};

export type AgentReviewEdge = {
  readonly __typename?: "AgentReviewEdge";
  readonly cursor: Scalars["String"]["output"];
  readonly node: AgentReview;
};

export type PageInfo = {
  readonly __typename?: "PageInfo";
  readonly endCursor?: Maybe<Scalars["String"]["output"]>;
  readonly hasNextPage: Scalars["Boolean"]["output"];
  readonly hasPreviousPage: Scalars["Boolean"]["output"];
  readonly startCursor?: Maybe<Scalars["String"]["output"]>;
};

export type Query = {
  readonly __typename?: "Query";
  /** The approved-review rating summary for an agent. */
  readonly agentRating: AgentRating;
  /** Approved reviews for an agent in newest-first order. */
  readonly agentReviews: AgentReviewConnection;
};

export type QueryAgentRatingArgs = {
  agentId: Scalars["ID"]["input"];
};

export type QueryAgentReviewsArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  agentId: Scalars["ID"]["input"];
  first?: Scalars["Int"]["input"];
};

export type RatingCount = {
  readonly __typename?: "RatingCount";
  readonly count: Scalars["Int"]["output"];
  readonly rating: Scalars["Int"]["output"];
};

export type UserSummary = {
  readonly __typename?: "UserSummary";
  readonly id: Scalars["ID"]["output"];
  readonly username?: Maybe<Scalars["String"]["output"]>;
};

export type AgentReviewsQueryVariables = Exact<{
  agentId: string | number;
  first: number;
  after?: string | null | undefined;
}>;

export type AgentReviewsQuery = {
  readonly agentReviews: {
    readonly edges: ReadonlyArray<{
      readonly cursor: string;
      readonly node: {
        readonly id: string;
        readonly rating: number;
        readonly reviewText: string | null;
        readonly createdAt: string;
        readonly author: {
          readonly id: string;
          readonly username: string | null;
        } | null;
      };
    }>;
    readonly pageInfo: {
      readonly hasNextPage: boolean;
      readonly endCursor: string | null;
    };
  };
};

export type AgentRatingQueryVariables = Exact<{
  agentId: string | number;
}>;

export type AgentRatingQuery = {
  readonly agentRating: {
    readonly agentId: string;
    readonly averageRating: number;
    readonly totalReviews: number;
    readonly ratingDistribution: ReadonlyArray<{
      readonly rating: number;
      readonly count: number;
    }>;
  };
};

export const AgentReviewsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "AgentReviews" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "agentId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "first" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "after" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "agentReviews" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "agentId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "agentId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "first" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "first" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "after" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "after" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "edges" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "cursor" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "node" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "id" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "rating" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "reviewText" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "createdAt" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "author" },
                              selectionSet: {
                                kind: "SelectionSet",
                                selections: [
                                  {
                                    kind: "Field",
                                    name: { kind: "Name", value: "id" },
                                  },
                                  {
                                    kind: "Field",
                                    name: { kind: "Name", value: "username" },
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "pageInfo" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "hasNextPage" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "endCursor" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<AgentReviewsQuery, AgentReviewsQueryVariables>;
export const AgentRatingDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "AgentRating" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "agentId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "agentRating" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "agentId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "agentId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "agentId" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "averageRating" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "totalReviews" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "ratingDistribution" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "rating" },
                      },
                      { kind: "Field", name: { kind: "Name", value: "count" } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<AgentRatingQuery, AgentRatingQueryVariables>;
