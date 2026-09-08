// deno-fmt-ignore-file
// biome-ignore format: generated types do not need formatting
// prettier-ignore
import type { PathsForPages, GetConfigResponse, SearchCodecsForPages } from 'waku/router';

// prettier-ignore
import type { getConfig as File_AppIndex_getConfig } from './pages/(app)/index';
// prettier-ignore
import type { getConfig as File_AuthLogin_getConfig } from './pages/(auth)/login';
// prettier-ignore
import type { getConfig as File_AuthRegister_getConfig } from './pages/(auth)/register';
// prettier-ignore
import type { getConfig as File_Root_getConfig } from './pages/_root';

// prettier-ignore
type Page =
| ({ path: '/' } & GetConfigResponse<typeof File_AppIndex_getConfig>)
| ({ path: '/login' } & GetConfigResponse<typeof File_AuthLogin_getConfig>)
| ({ path: '/register' } & GetConfigResponse<typeof File_AuthRegister_getConfig>)
| ({ path: '/_root' } & GetConfigResponse<typeof File_Root_getConfig>);

// prettier-ignore
type Layout =
| { path: '/' };

// prettier-ignore
declare module 'waku/router' {
  interface RouteConfig {
    paths: PathsForPages<Page>;
  }
  interface CreatePagesConfig {
    pages: Page;
    layouts: Layout;
  }
  interface SearchCodecsConfig extends SearchCodecsForPages<Page> {}
}
