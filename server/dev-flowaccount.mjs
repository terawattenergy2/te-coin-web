import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const children=[];let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const c of children)c.kill('SIGTERM');process.exitCode=code;}
const api=spawn(process.execPath,['server/flowaccount.mjs'],{stdio:'inherit'});children.push(api);
const web=spawn(process.execPath,[require.resolve('react-scripts/bin/react-scripts.js'),'start'],{stdio:'inherit',env:{...process.env,PORT:process.env.PORT||'3003',BROWSER:'none'}});children.push(web);
for(const child of children){child.on('error',()=>stop(1));child.on('exit',code=>stop(code||0));}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
