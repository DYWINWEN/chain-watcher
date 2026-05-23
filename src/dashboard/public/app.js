// chain-watcher dashboard entry — boots router + theme + SSE + cmdk.
import { startTheme } from './js/theme.js';
import { startRouter } from './js/router.js';
import { startCmdK } from './js/ui/cmdk.js';
import './js/sse.js'; // side-effect: opens singleton EventSource

startTheme();
startRouter();
startCmdK();
