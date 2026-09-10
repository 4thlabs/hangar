// deno-fmt-ignore-file
// biome-ignore format: generated types do not need formatting
// prettier-ignore
import type { PathsForPages, GetConfigResponse, SearchCodecsForPages } from 'waku/router';

// prettier-ignore
import type { getConfig as File_AppApps_getConfig } from './pages/(app)/apps';
// prettier-ignore
import type { getConfig as File_AppIndex_getConfig } from './pages/(app)/index';
// prettier-ignore
import type { getConfig as File_AppSettings_getConfig } from './pages/(app)/settings';
// prettier-ignore
import type { getConfig as File_AppStore_getConfig } from './pages/(app)/store';
// prettier-ignore
import type { getConfig as File_AppUserSettings_getConfig } from './pages/(app)/user/settings';
// prettier-ignore
import type { getConfig as File_AuthLogin_getConfig } from './pages/(auth)/login';
// prettier-ignore
import type { getConfig as File_AuthRegister_getConfig } from './pages/(auth)/register';
// prettier-ignore
import type { getConfig as File_Root_getConfig } from './pages/_root';

// prettier-ignore
type Page =
| ({ path: '/apps' } & GetConfigResponse<typeof File_AppApps_getConfig>)
| ({ path: '/' } & GetConfigResponse<typeof File_AppIndex_getConfig>)
| ({ path: '/settings' } & GetConfigResponse<typeof File_AppSettings_getConfig>)
| ({ path: '/store' } & GetConfigResponse<typeof File_AppStore_getConfig>)
| ({ path: '/user/settings' } & GetConfigResponse<typeof File_AppUserSettings_getConfig>)
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
