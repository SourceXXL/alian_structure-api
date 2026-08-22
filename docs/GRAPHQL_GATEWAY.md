# GraphQL Gateway

The GraphQL gateway is a typed frontend-facing layer over existing NestJS
services. It does not replace the REST API or duplicate review business logic.

```text
TypeScript client -> authenticated Nest HTTP controller -> GraphQL execution
                                                        -> AgentReviewsService
                                                        -> TypeORM
                                                        -> request-local author DataLoader
```

The gateway uses the reference `graphql` implementation behind a normal Nest
controller, so it follows the application's existing HTTP lifecycle without
adding a second web server or an Apollo-specific runtime.

## Endpoint and authentication

Send GraphQL requests to:

```text
POST /api/v1/graphql
Authorization: Bearer <access-token>
Content-Type: application/json
```

The endpoint uses the same global strategy authentication, quota, role, and
KYC guards as REST. Schema introspection is disabled when
`NODE_ENV=production`. Only approved reviews and safe author fields (`id` and
`username`) are exposed; passwords, tokens, moderation details, and other
credentials are absent from the schema.

## Queries

- `agentReviews(agentId: ID!, first: Int! = 20, after: String)` returns
  approved reviews in a connection.
- `agentRating(agentId: ID!)` returns the approved review average, count, and
  1-5 star distribution.

Example:

```graphql
query AgentReviews($agentId: ID!, $first: Int!, $after: String) {
  agentReviews(agentId: $agentId, first: $first, after: $after) {
    edges {
      cursor
      node {
        id
        rating
        reviewText
        createdAt
        author {
          id
          username
        }
      }
    }
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
  }
}
```

## Pagination

The first page omits `after`. Page size `first` must be an integer from 1 to 50. Results use stable keyset ordering:

```text
createdAt DESC, id DESC
```

The UUID tiebreaker prevents duplicate or skipped records when reviews have
the same creation timestamp. A composite database index covers the agent,
approval status, timestamp, and ID traversal. The service reads one extra row
to calculate `hasNextPage`, avoiding a count query. Cursors are URL-safe,
versioned, and opaque: clients must store and return them unchanged and must
not decode, construct, or infer meaning from them. Malformed, non-canonical,
unsupported, or stale-format cursors return a bad-request GraphQL error.

To fetch another page, pass the previous `pageInfo.endCursor` as `after` only
when `pageInfo.hasNextPage` is true. Empty and final pages return
`hasNextPage: false`; an empty page has null start and end cursors.

## DataLoader batching

The `AgentReview.author` relationship uses one DataLoader instance per request.
All author IDs selected in a query are resolved through one
`UserService.findManyByIds` lookup, and duplicate IDs use the request-local
cache. A new loader and cache are created for every request, preventing data
from leaking between clients or authenticated users.

## Generated TypeScript types

The schema is [schema.graphql](../src/graphql/schema.graphql), and frontend
operations are in
[operations.graphql](../src/graphql/client/operations.graphql). Generate the
typed result/variable definitions and `TypedDocumentNode` values with:

```bash
npm run graphql:codegen
```

The checked-in output is
[generated.ts](../src/graphql/client/generated.ts). Frontends can import the
generated documents, operation types, and example helpers through the
[client entry point](../src/graphql/client/index.ts). CI regenerates the types,
fails if the committed SDK is stale, and runs the gateway and pagination tests.

## Typed client example

[example.ts](../src/graphql/client/example.ts) uses the generated documents and
operation types with the platform `fetch` API. `loadAgentReviews` demonstrates
safe field access, reading `endCursor`, checking `hasNextPage`, and loading the
next page. `loadAgentRating` returns a fully typed rating summary, while the
exported `executeGraphql` helper supports additional generated operations
without adding a frontend framework or GraphQL client dependency.

## Development and testing

```bash
npm install
npm run graphql:codegen
npx tsc --noEmit
npm test
npm run build
```

GraphQL unit, execution, and HTTP contract tests cover cursor validation,
stable ordering, first/next/final/empty pages, argument limits, query execution,
author batching, request cache isolation, authentication, and the documented
`/api/v1/graphql` route.
