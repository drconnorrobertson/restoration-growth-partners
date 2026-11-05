#!/usr/bin/env python3
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit,unquote
import xml.etree.ElementTree as ET
import json,re,collections,hashlib,sys
ROOT=Path(__file__).resolve().parent.parent
HOST='https://restoration-growth-partners.vercel.app'
class Parse(HTMLParser):
 def __init__(self):
  super().__init__();self.links=[];self.assets=[];self.h1=[];self.titles=[];self.canon=[];self.robots=[];self.desc=[];self.cur=None;self.schema=[];self.script=None;self.ids=set();self.data=None
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if 'id' in a:self.ids.add(a['id'])
  if tag=='a' and 'href' in a:self.links.append(a['href'])
  if tag in ['script','img','link']:
   v=a.get('src') or (a.get('href') if tag=='link' and a.get('rel') in ['stylesheet','icon','preload','modulepreload'] else None)
   if v and v.startswith('/'):self.assets.append(v)
  if tag in ['h1','title']:self.cur=tag
  if tag=='link' and a.get('rel')=='canonical':self.canon.append(a.get('href'))
  if tag=='meta' and a.get('name')=='robots':self.robots.append(a.get('content',''))
  if tag=='meta' and a.get('name')=='description':self.desc.append(a.get('content',''))
  if tag=='script' and a.get('type')=='application/ld+json':self.script='schema'
  elif tag=='script' and 'data-playbook-data' in a:self.script='data'
 def handle_data(self,data):
  if self.cur=='h1':self.h1.append(data)
  if self.cur=='title':self.titles.append(data)
  if self.script=='schema':self.schema.append(json.loads(data))
  elif self.script=='data':self.data=json.loads(data)
 def handle_endtag(self,tag):
  if tag==self.cur:self.cur=None
  if tag=='script':self.script=None
files=sorted((ROOT/'playbooks').rglob('index.html'))
errors=[];parsed={};titles=[];h1s=[];metas=[];schemas=0;link_count=0;asset_count=0
for f in files:
 path='/'+str(f.parent.relative_to(ROOT));p=Parse();raw=f.read_text()
 try:p.feed(raw)
 except Exception as e:errors.append([path,'parse',str(e)]);continue
 parsed[path]=p
 title=''.join(p.titles);h1=''.join(p.h1)
 if len(p.canon)!=1 or p.canon[0]!=HOST+path:errors.append([path,'canonical',p.canon])
 if not title or not h1:errors.append([path,'missing title/h1'])
 if len(re.findall(r'<h1\b',raw))!=1:errors.append([path,'h1 count'])
 if any('noindex' in v for v in p.robots):errors.append([path,'noindex'])
 if len(p.desc)!=1 or not p.desc[0]:errors.append([path,'description'])
 if not p.schema:errors.append([path,'missing structured data'])
 schemas+=len(p.schema)
 if re.search(r'\{(?:service|segment|buyer|query|fields|proof|intent|asset|boundary)\}',raw):errors.append([path,'unresolved token'])
 if p.data:
  if len(p.data['rows'])!=4 or len(p.data['steps'])!=4:errors.append([path,'worksheet shape'])
  if len(set(p.data['rows'][i][0] for i in range(4)))!=4:errors.append([path,'worksheet labels'])
 for asset in p.assets:
  local=ROOT/unquote(urlsplit(asset).path).lstrip('/')
  if not local.is_file():errors.append([path,'missing asset',asset])
  asset_count+=1
 for target in p.links:
  u=urlsplit(target)
  if u.scheme or u.netloc or not u.path.startswith('/'):
   if target.startswith('#') and target[1:] not in p.ids:errors.append([path,'missing anchor',target])
   continue
  q=ROOT/unquote(u.path).lstrip('/')
  if not(q.is_file() or (q/'index.html').is_file() or Path(str(q)+'.html').is_file()):errors.append([path,'missing internal target',target])
  link_count+=1
 titles.append(title);h1s.append(h1);metas+=p.desc
for name,vals in [('titles',titles),('headings',h1s),('descriptions',metas)]:
 dup=[v for v,n in collections.Counter(vals).items() if n>1]
 if dup:errors.append(['duplicate '+name,len(dup),dup[:3]])
# Reachability from the library root: every new page must have an incoming navigation path.
seen=set();todo=['/playbooks']
while todo:
 path=todo.pop()
 if path in seen:continue
 seen.add(path)
 p=parsed.get(path)
 if p:
  for target in p.links:
   u=urlsplit(target)
   if not u.scheme and u.path in parsed and u.path not in seen:todo.append(u.path)
orphans=set(parsed)-seen
if orphans:errors.append(['orphan pages',len(orphans),sorted(orphans)[:3]])
ns={'s':'http://www.sitemaps.org/schemas/sitemap/0.9'}
index=ET.parse(ROOT/'sitemap-playbooks.xml').getroot();sitemap_urls=[]
for loc in index.findall('s:sitemap/s:loc',ns):
 f=ROOT/loc.text.replace(HOST+'/','');x=ET.parse(f).getroot();locs=[e.text for e in x.findall('s:url/s:loc',ns)];sitemap_urls+=locs
 if len(locs)>500:errors.append(['oversize sitemap chunk',str(f)])
if set(sitemap_urls)!={HOST+p for p in parsed}:errors.append(['sitemap page mismatch'])
if len(sitemap_urls)!=len(set(sitemap_urls)):errors.append(['duplicate sitemap URLs'])
inventory=json.loads((ROOT/'content-engine/inventory.json').read_text())
if len(inventory)!=4000:errors.append(['content count',len(inventory)])
if len(set(i['primary_keyword'] for i in inventory))!=4000:errors.append(['duplicate primary keywords'])
if min(i['word_count'] for i in inventory)<800:errors.append(['main content below minimum'])
# Original source integrity is independent of generated live pages.
manifest=json.loads((ROOT/'design-source/manifest.json').read_text());verified=0
if hashlib.sha256((ROOT/'design-source/rgp-website-main.zip').read_bytes()).hexdigest()!=manifest['archive_sha256']:errors.append(['archive changed'])
for item in manifest['files']:
 f=ROOT/'design-source'/item['path']
 if f.exists():
  if hashlib.sha256(f.read_bytes()).hexdigest()!=item['sha256']:errors.append(['source changed',item['path']])
  verified+=1
report={'passed':not errors,'content_pages':4000,'navigation_hubs':len(files)-4000,'total_new_pages':len(files),'unique_titles':len(set(titles)),'unique_h1s':len(set(h1s)),'unique_descriptions':len(set(metas)),'unique_target_keywords':len(set(i['primary_keyword'] for i in inventory)),'reachable_pages_from_library_root':len(seen),'internal_link_checks':link_count,'local_asset_checks':asset_count,'structured_data_blocks':schemas,'sitemap_urls':len(sitemap_urls),'min_main_words':min(i['word_count'] for i in inventory),'max_main_words':max(i['word_count'] for i in inventory),'original_extracted_files_hash_verified':verified,'original_archive_sha256_verified':True,'errors':errors[:50],'error_count':len(errors),'limitations':['Keyword search volume and difficulty unverified: connected GSC subscription inactive.','Indexing and traffic are not guaranteed or established by these checks.','One original extracted synthetic-credential test fixture remains blocked by GitHub, preserved inside unchanged ZIP.']}
(ROOT/'content-engine/validation-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));sys.exit(0 if not errors else 1)
