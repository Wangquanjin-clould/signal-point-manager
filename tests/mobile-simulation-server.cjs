'use strict';
const fs=require('node:fs'),path=require('node:path');
const dir=path.resolve('tmp/mobile-simulation-'+Date.now());fs.mkdirSync(dir,{recursive:true});
fs.copyFileSync('database/vps-snapshot-20261023.db',path.join(dir,'signal-points.db'));
process.env.DATA_DIR=dir;process.env.PORT=process.env.PORT||'8792';process.env.HOST='127.0.0.1';process.env.MOBILE_SYNC_TOKEN='simulation-only-token-with-32-characters';
console.log('Simulation fixture only:',dir);
require('../server');
