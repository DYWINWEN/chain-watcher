import { getDb, closeDb } from './db.js';
import { logger } from '../utils/logger.js';

getDb();
logger.info('migrations complete');
closeDb();
