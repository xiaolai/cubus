import { BlewTransport } from '../src/transport/blew.js';
import { GanCube } from '../src/driver.js';

const ID = 'BBD8635C-78B0-08F9-A5DA-238B635D57D2';
const MAC = '54:6C:50:89:C8:D3';

const t = new BlewTransport(ID);
const sub = t.subscribe('FFF6');
let raw = 0;
sub.on('packet', () => { if (raw < 3) console.log('raw packet', ++raw); else raw++; });
sub.on('error', (e) => console.log('sub error', e.message));
sub.on('close', (c) => console.log('sub close', c));

const gan = new GanCube({ mac: MAC, transport: t });
gan.onEvent((e) => console.log('event', e.type));
gan.on('live', () => console.log('LIVE'));
gan.connect();

setTimeout(() => { console.log(`total raw=${raw}`); t.disconnect(); process.exit(0); }, 12000);
