/**
 * A cheaper `select()` for the untyped Supabase clients (plan #2205.2).
 *
 * Every client in this app is created without a `Database` type, so its
 * schema is `any`. For that case postgrest-js still parses each select string
 * at the type level, character by character, to infer a row such as
 * `{ id: any; name: any }`. With about 2,300 select calls, that parsing was
 * 7.3 million of the type check's 9.4 million instantiations and about
 * 1.6 GiB of its peak memory, for rows whose every field is `any` anyway.
 *
 * The overloads below come before the library's own and apply only when the
 * schema is `any`. The column list is a plain `string`, so nothing is parsed,
 * and each row is `any`. Code that needs a row type states it, with
 * `.single<Row>()`, `.returns<Row[]>()` or `as Row[]` as most of the app
 * already does. A client given a real `Database` type cannot pass a string
 * where these overloads take `never`, so it gets the library's own `select()`
 * with full inference.
 *
 * Nothing here exists at runtime.
 */
import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';

type IsAnySchema<Schema> = 0 extends 1 & Schema ? true : false;

// What the parser produced for these clients: fields of type `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

declare module '@supabase/postgrest-js' {
  // `from(...).select(...)`. The type parameters keep the names the library's
  // class gives them, which declaration merging requires.
  interface PostgrestQueryBuilder<ClientOptions, Schema, Relation$1, RelationName, Relationships> {
    select(
      columns?: IsAnySchema<Schema> extends true ? string : never,
      options?: {
        head?: boolean;
        count?: 'exact' | 'planned' | 'estimated' | (string & {});
      },
    ): PostgrestFilterBuilder<ClientOptions, Schema, Relation$1['Row'], AnyRow[], RelationName, Relationships, 'GET'>;
  }

  // `.insert(...).select(...)`, `.update(...).select(...)`, `.rpc(...).select(...)`.
  interface PostgrestTransformBuilder<ClientOptions, Schema, Row, Result$1, RelationName, Relationships, Method, ThrowOnError> {
    select(
      columns?: IsAnySchema<Schema> extends true ? string : never,
    ): PostgrestFilterBuilder<
      ClientOptions,
      Schema,
      Row,
      Method extends 'RPC' ? (Result$1 extends unknown[] ? AnyRow[] : AnyRow) : AnyRow[],
      RelationName,
      Relationships,
      Method,
      ThrowOnError
    >;
  }
}
