import { readFileSync, writeFileSync, cpSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const build=resolve(process.argv[2]);
const baseline='c7cd55854422f9393254d79a57707e43b2d494ea';
const fromGit=(path)=>execFileSync('git',['show',`${baseline}:${path}`],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
const html=readFileSync(join(build,'dist/index.html'),'utf8');
writeFileSync(join(root,'index.html'),html);
const copyAssets=(dir,rel='')=>{for(const e of readdirSync(dir,{withFileTypes:true})){const r=join(rel,e.name);if(e.isDirectory())copyAssets(join(dir,e.name),r);else if(!e.name.startsWith('placeholder-')){const target=join(root,'_astro',r);mkdirSync(dirname(target),{recursive:true});cpSync(join(dir,e.name),target);}}};
copyAssets(join(build,'dist/_astro'));
for(const f of ['favicon-32.png','favicon-192.png','apple-touch-icon.png','og-default.png'])cpSync(join(build,'public',f),join(root,f));
cpSync(join(build,'src/assets/brand/logo.png'),join(root,'rgp-logo.png'));
const newBody=html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
const prefix=newBody.slice(0,newBody.indexOf('<main>'));
const suffix=newBody.slice(newBody.lastIndexOf('</main>')+7);
const missingSymbols=[...html.matchAll(/<symbol\b[^>]*id="([^"]+)"[^>]*>[\s\S]*?<\/symbol>/g)].filter(m=>!(prefix+suffix).includes(`id="${m[1]}"`)).map(m=>m[0]).join('');
const sprite=`<svg aria-hidden="true" width="0" height="0" style="position:absolute;overflow:hidden"><defs>${missingSymbols}</defs></svg>`;
const head=html.match(/<head>([\s\S]*?)<\/head>/)[1];
const resources=[...head.matchAll(/<link\b[^>]*(?:href="\/_astro\/)[^>]*>|<style\b[^>]*>[\s\S]*?<\/style>|<script\b[^>]*src="\/_astro\/[^>]*><\/script>/g)].map(x=>x[0]).join('');
const legacyCSS=fromGit('assets/style.css').replaceAll(':root', ':scope');
writeFileSync(join(root,'_astro/legacy-content.css'),`@scope (.legacy-content) {\n${legacyCSS}\n}\n@scope (.legacy-content) { h1,h2,h3,h4 {font-family:var(--font-display);color:var(--color-ink)} .hero{background:var(--color-dark)} .hero h1{color:var(--color-on-dark)} .hero p{color:var(--color-on-dark)} .btn-primary{background:var(--color-accent);color:white} .btn-primary:hover{background:var(--color-accent-hover)} .btn-outline{border-color:var(--color-accent);color:var(--color-accent)} .hero .btn-outline{border-color:var(--color-on-dark);color:var(--color-on-dark)} }\n`);
const paths=execFileSync('git',['ls-tree','-r','--name-only',baseline],{cwd:root,encoding:'utf8'}).split('\n').filter(p=>p.endsWith('.html')&&p!=='index.html'&&!p.startsWith('design-source/'));
let count=0;
for(const path of paths){
 const old=fromGit(path);
 const bodyMatch=old.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
 if(!bodyMatch||!/<header\b/i.test(bodyMatch[1])||!/<footer\b/i.test(bodyMatch[1]))continue;
 let content=bodyMatch[1].replace(/<header\b[^>]*>[\s\S]*?<\/header>/i,'').replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/i,'');
 // Preserve the existing editorial page content and metadata inside the ZIP shell.
 let next=old.replace(/<body[^>]*>[\s\S]*?<\/body>/i,`<body data-rgp-live-shell>${sprite}${prefix}<main class="legacy-content">${content}</main>${suffix}</body>`);
 next=next.replace(/<link[^>]*href="[^"]*(?:assets\/style\.css)[^"]*"[^>]*>/g,'');
 next=next.replace('</head>',`${resources}<link rel="stylesheet" href="/_astro/legacy-content.css"></head>`);
 const dest=join(root,path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,next);count++;
}
console.log(`Applied the ZIP header, footer, fonts, and agency CTAs to ${count} existing pages; page content, URLs, metadata and redirects retained.`);
