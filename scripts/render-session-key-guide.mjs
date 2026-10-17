#!/usr/bin/env node
// Optional authoring command. Runtime/CI serves committed media without
// Playwright or FFmpeg dependencies. The scene uses only fictional values.
import { mkdir, mkdtemp, rm, writeFile, copyFile, readFile, chmod } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { KEY_GUIDE_STEPS, guideVtt } from '../content/session-key-guide.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const output=resolve(process.argv[2]||join(root,'assets/gettoken'));
const {chromium}=await import(process.env.GETTOKEN_PLAYWRIGHT_MODULE||'playwright');
const temporary=await mkdtemp(join(tmpdir(),'gettoken-guide-frames-'));
const drawing=await readFile(join(root,'scripts/session-key-guide/scene.html'));
const server=createServer((request,response)=>{response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(drawing);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
const fps=12,duration=KEY_GUIDE_STEPS.at(-1).end;
try{
 browser=await chromium.launch({headless:true,...(process.env.GETTOKEN_CHROMIUM_BIN?{executablePath:process.env.GETTOKEN_CHROMIUM_BIN}:{}),args:['--no-sandbox']});
 await mkdir(output,{recursive:true});
 const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
 // An isolated browser loads only our local drawing, never claude.ai or an account.
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.evaluate(()=>document.fonts.ready);
 for(let frame=0;frame<fps*duration;frame++){
  await page.evaluate(({time,steps})=>window.draw(time,steps),{time:frame/fps,steps:KEY_GUIDE_STEPS});
  const file=join(temporary,`frame-${String(frame).padStart(4,'0')}.png`);
  await page.screenshot({path:file});
  if(frame===0)await copyFile(file,join(output,'session-key-guide.png'));
  if(frame%60===0)console.log(`Rendered ${frame}/${fps*duration} fictional tutorial frames`);
 }
 execFileSync(process.env.GETTOKEN_FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate',String(fps),'-i',join(temporary,'frame-%04d.png'),'-c:v','libx264','-preset','medium','-crf','21','-g','24','-pix_fmt','yuv420p','-movflags','+faststart',join(output,'session-key-guide.mp4')],{maxBuffer:1024*1024});
 await writeFile(join(output,'session-key-guide.vtt'),guideVtt());
 for(const name of ['session-key-guide.mp4','session-key-guide.png','session-key-guide.vtt'])await chmod(join(output,name),0o644);
 console.log(`Exported ${duration}s MP4, poster and Chinese subtitles to ${output}`);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(temporary,{recursive:true,force:true});}
