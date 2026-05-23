// chain-watcher dashboard entry — boots router + theme + SSE.
import { startTheme } from './js/theme.js';
import { startRouter } from './js/router.js';
import './js/sse.js'; // side-effect: opens singleton EventSource

startTheme();
startRouter();
