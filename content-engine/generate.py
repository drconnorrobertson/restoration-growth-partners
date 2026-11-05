#!/usr/bin/env python3
"""Build 4,000 distinct marketing worksheets, hierarchical indexes, and discovery files."""
from pathlib import Path
import re,json,csv,html,hashlib,collections,shutil
from catalog import SERVICES,SEGMENTS,TASKS
ROOT=Path(__file__).resolve().parent.parent
HOST='https://restoration-growth-partners.vercel.app'
DATE='2026-11-05'
H=html.escape
original=(ROOT/'index.html').read_text()
body=re.search(r'<body[^>]*>([\s\S]*)</body>',original)[1]
prefix=body[:body.index('<main>')]
suffix=body[body.rfind('</main>')+7:]
head=re.search(r'<head>([\s\S]*?)</head>',original)[1]
resources=''.join(m[0] for m in re.finditer(r'<link\b[^>]*(?:href="/_astro/)[^>]*>|<style\b[^>]*>[\s\S]*?</style>|<script\b[^>]*src="/_astro/[^>]*></script>',head))
missing=[]
for m in re.finditer(r'<symbol\b[^>]*id="([^"]+)"[^>]*>[\s\S]*?</symbol>',original):
 if f'id="{m[1]}"' not in prefix+suffix:missing.append(m[0])
sprite='<svg aria-hidden="true" width="0" height="0" style="position:absolute;overflow:hidden"><defs>'+''.join(missing)+'</defs></svg>'
assets=ROOT/'assets';assets.mkdir(exist_ok=True)
for name in ['playbooks.css','playbooks.js']:shutil.copy2(ROOT/'content-engine'/name,assets/name)
pages=[];inventory=[]
def write(path,text):
 f=ROOT/path.lstrip('/')/'index.html';f.parent.mkdir(parents=True,exist_ok=True);f.write_text(text)
def link(path,label):return f'<a href="{H(path,quote=True)}">{H(label)}</a>'
def path_for(s,g,t):return f"/playbooks/{s['slug']}/{g['slug']}/{t['slug']}"
def crumbs(items):return '<nav class="pb-breadcrumb" aria-label="Breadcrumb">'+ ' <span aria-hidden="true">/</span> '.join(link(p,n) for p,n in items)+'</nav>'
def page(path,title,desc,content,crumbs_data,article=False,meta_title=None):
 schema={'@context':'https://schema.org','@graph':[{'@type':'BreadcrumbList','itemListElement':[{'@type':'ListItem','position':i+1,'name':n,'item':HOST+p} for i,(p,n) in enumerate(crumbs_data)]},{'@type':'Article' if article else 'CollectionPage','@id':HOST+path+'#page','url':HOST+path,'headline':title,'description':desc,'inLanguage':'en','publisher':{'@type':'Organization','name':'Restoration Growth Partners','url':HOST},'datePublished':DATE,'dateModified':DATE}]}
 schema_json=json.dumps(schema).replace('<',chr(92)+'u003c')
 doc=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{H(meta_title or title)} | RGP</title><meta name="description" content="{H(desc,quote=True)}"><meta name="robots" content="index,follow"><link rel="canonical" href="{HOST+path}"><link rel="icon" href="/favicon-32.png"><meta property="og:type" content="{'article' if article else 'website'}"><meta property="og:title" content="{H(title,quote=True)}"><meta property="og:description" content="{H(desc,quote=True)}"><meta property="og:url" content="{HOST+path}"><meta property="og:image" content="{HOST}/og-default.png">{resources}<link rel="stylesheet" href="/assets/playbooks.css"><script defer src="/assets/playbooks.js"></script><script type="application/ld+json">{schema_json}</script></head><body>{sprite}{prefix}<main class="pb" data-rgp-playbook>{content}</main>{suffix}</body></html>'''
 write(path,doc);pages.append(path)

def context(s,g):
 return dict(service=s['name'],service_short=s['short'],service_slug=s['slug'],segment=g['name'],segment_slug=g['slug'],buyer=g['buyer'],need=s['need'],intent=s['intent'],proof=s['proof'],qualify=s['qualify'],exclude=s['exclude'][0],negative=g['negative'][0],query=s['queries'][0],asset=s['assets'][0],boundary=s['boundary'],priority=g['priority'],constraint=g['constraint'],fields=', '.join(g['fields']),segment_proof=g['proof'],handoff=g['handoff'],objection=s['objection'])

def card(path,title,desc,count=''):
 return f'<a class="pb-card" href="{H(path)}" data-filter-card><span class="pb-count">{H(count)}</span><h3>{H(title)}</h3><p>{H(desc)}</p></a>'

def calc(t):
 if t['slug']=='campaign-budget-scenario':
  fields=[('spend','Marketing spend ($)'),('cpc','Assumed cost per click ($)'),('contact','Assumed contact rate (%)'),('qualified','Assumed qualification rate (%)')]
  return '<section class="pb-panel" id="scenario"><h2>Calculate your own planning scenario</h2><p>Use your records or explicitly chosen assumptions. All inputs start at zero; no market CPC, demand, or conversion benchmark is implied.</p><form data-budget-calculator><div class="pb-fields">'+''.join(f'<label class="pb-field">{label}<input name="{name}" type="number" min="0" '+('max="100" ' if name in ['contact','qualified'] else '')+'step="0.01" value="0"></label>' for name,label in fields)+'</div></form><div class="pb-results" data-budget-result aria-live="polite"></div></section>'
 if t['slug'] in ['qualified-lead-cost-calculator','marketing-roi-worksheet']:
  mode='cpl' if t['slug']=='qualified-lead-cost-calculator' else 'contribution'
  fields=[('cost','Eligible marketing cost ($)'),('count','Qualified inquiries')] if mode=='cpl' else [('revenue','Attributed revenue ($)'),('project','Relevant project costs ($)'),('marketing','Marketing costs ($)')]
  return f'<section class="pb-panel" id="scenario"><h2>Use your actual inputs</h2><p>Keep the reporting period and cost definitions consistent. This tool calculates your inputs; it does not forecast outcomes or establish causation.</p><form data-unit-calculator="{mode}"><div class="pb-fields">'+''.join(f'<label class="pb-field">{label}<input name="{name}" type="number" min="0" step="0.01" value="0"></label>' for name,label in fields)+'</div></form><div class="pb-results" data-unit-result aria-live="polite"></div></section>'
 return ''

for si,s in enumerate(SERVICES):
 for gi,g in enumerate(SEGMENTS):
  c=context(s,g)
  for ti,t in enumerate(TASKS):
   path=path_for(s,g,t)
   title=f"{t['title']} for {s['name']} in {g['name']}"
   desc=f"A practical {t['title'].lower()} for teams marketing {s['name']} to {g['name']}: examples, steps, and an editable worksheet."
   rows=[[cell.format(**c) for cell in row] for row in t['rows']]
   keyword=f"{t['title'].lower()} for {g['keyword']} {s['name']}"
   payload={'title':title,'buyer':g['buyer'],'goal':t['goal'],'rows':rows,'steps':t['steps'],'metric':t['metric'],'url':HOST+path,'slug':s['slug']+'-'+g['slug']+'-'+t['slug']}
   payload_json=json.dumps(payload,ensure_ascii=False).replace('<','\\u003c')
   related=[(path_for(s,g,TASKS[(ti+1)%40]),TASKS[(ti+1)%40]['title']), (path_for(s,g,TASKS[(ti-1)%40]),TASKS[(ti-1)%40]['title']), (path_for(s,SEGMENTS[(gi+1)%10],t),f"{t['title']} for {SEGMENTS[(gi+1)%10]['name']}"), (path_for(SERVICES[(si+1)%10],g,t),f"{t['title']} for {SERVICES[(si+1)%10]['name']}")]
   crumb=[('/','Home'),('/playbooks','Playbooks'),('/playbooks/'+s['slug'],s['short']),('/playbooks/'+s['slug']+'/'+g['slug'],g['name']), (path,t['title'])]
   worksheet=''.join('<tr>'+''.join('<td>'+H(v)+'</td>' for v in row)+'</tr>' for row in rows)
   # Task-specific answer + distinct service and buyer requirements precede the worksheet.
   content=f'''<div class="pb-hero"><div class="pb-wrap">{crumbs(crumb[:-1])}<p class="pb-kicker">{H(t['group'])} · Field worksheet</p><h1>{H(title)}</h1><p class="pb-lead">{H(t['goal'])} This playbook applies that task to {H(s['name'])} inquiries involving {H(g['name'])}, with the {H(g['buyer'])} as the intended decision-making contact.</p><p class="pb-subtitle">By Restoration Growth Partners · Published November 5, 2026 · Practical planning resource</p></div></div>
<div class="pb-wrap pb-layout"><article>
<section id="answer"><h2>The decision this worksheet helps you make</h2><p>{H(s['angle'])}</p><p>For {H(g['name'])}, the immediate marketing priority is {H(g['priority'])}. The work should help an authorized person understand the service, decide whether the provider fits, and reach the correct next conversation. {H(g['decision'].capitalize())}.</p><div class="pb-note"><strong>Use this as a working example.</strong> The search phrases, message concepts, and workflow entries below are editorial starting points, not verified search-volume estimates, platform approvals, or results from an RGP client campaign. Replace them with your company’s actual scope and records before use.</div></section>
<section id="context"><h2>What changes for this service and buyer</h2><h3>Service intent: {H(s['short'])}</h3><p>A relevant inquiry may concern {H(s['need'])}. The page or campaign should clarify {H(s['intent'])}. {H(s['boundary'])}</p><h3>Property context: {H(g['name'])}</h3><p>{H(g['constraint'])} Useful supporting material includes {H(g['proof'])}, alongside {H(s['proof'])}.</p><p>{H(g['channel'])} This distinction matters when reviewing whether a query, form record, or conversation belongs in the qualified pipeline.</p></section>
<section id="worksheet"><h2>Your {H(t['title'].lower())}</h2><p>The entries below connect the task to this exact service and property context. Review the working example and implementation note together; a short label on its own does not establish service eligibility or buyer intent.</p><div class="pb-table-wrap"><table><caption class="sr-only">{H(title)} working example</caption><thead><tr><th scope="col">Field</th><th scope="col">Working example</th><th scope="col">Implementation note</th></tr></thead><tbody>{worksheet}</tbody></table></div></section>
{calc(t)}
<section id="implementation"><h2>Put the worksheet into practice</h2><ol>{''.join('<li>'+H(step)+'</li>' for step in t['steps'])}</ol><h3>Gather the right inputs first</h3><p>{H(s['qualify'])} For this property context, the useful routing fields are {H(', '.join(g['fields']))}. Keep optional material separate and request it only when the team has a defined use for it.</p><h3>Make the handoff explicit</h3><p>{H(g['handoff'])} Record the source, owner, and next action so the marketing output can be compared with a real business process rather than treated as an isolated asset.</p></section>
<section class="pb-panel" id="editor"><h2>Customize and export the worksheet</h2><p>Add a business name and broad service area to prepare a copy for your team. The tool runs in your browser; these entries are not submitted to RGP or saved by this worksheet.</p><form data-planner><div class="pb-fields"><label class="pb-field">Business name<input name="company" type="text" maxlength="100" placeholder="Your company" autocomplete="organization"></label><label class="pb-field">Service area<input name="market" type="text" maxlength="100" placeholder="City or operating region" autocomplete="off"></label></div></form><label class="pb-field" for="worksheet-output">Editable working copy</label><textarea id="worksheet-output" data-plan-output aria-label="Editable worksheet">{H(title)}\n{H(t['goal'])}</textarea><div class="pb-buttons"><button type="button" class="pb-button" data-copy-plan>Copy worksheet</button><button type="button" class="pb-button pb-button-secondary" data-download-plan>Download CSV</button></div><p class="pb-status" data-plan-status role="status"></p><p class="pb-download-note">The CSV contains the structured worksheet. Review all examples before applying them to a live campaign.</p><script type="application/json" data-playbook-data>{payload_json}</script></section>
<section id="measurement"><h2>How to judge whether it helped</h2><p>{H(t['metric'])} Use the same reporting period and qualification definitions when comparing results. If you do not have an observed baseline, record that gap rather than filling it with an industry average or an assumed improvement.</p><p>For {H(s['name'])} in {H(g['name'])}, a useful review includes the buyer’s actual next action, whether the request matches the offered scope, and whether the responsible team received the information required to proceed.</p><div class="pb-note"><strong>Avoid this mistake:</strong> {H(t['mistake'])}</div></section>
<section id="questions"><h2>Questions to resolve before launch</h2><h3>{H(s['objection'])}</h3><p>Show the company’s actual assessment and scope process. Use {H(s['assets'][1])} if it accurately reflects the offered work. A marketing worksheet cannot establish the condition of an individual property or replace the qualified team’s assessment.</p><h3>Who should own the next conversation?</h3><p>For {H(g['name'])}, start with the {H(g['buyer'])}. {H(g['handoff'])}</p><h3>What should be verified before using this plan?</h3><p>Confirm the service boundary, the contact destination, the evidence permissions, and the current platform rules for the chosen channel. Check that the final page or message answers a distinct buyer need rather than duplicating a page that already does the job.</p></section>
<section id="sources"><h2>Reference and next resources</h2><p>This is an RGP planning framework applied to a specific business scenario. For the platform requirements relevant to this task, consult {link(t['source'],'the official Google reference')}. Editorial examples are not a substitute for the current platform settings, a business’s actual records, or qualified professional review.</p><ul>{''.join('<li>'+link(p,n)+'</li>' for p,n in related)}</ul><p>{link('/services/','Explore RGP marketing services')} or {link('/contact/','discuss the marketing system for your business')} when you are ready to apply the worksheet to an actual operation.</p></section>
</article><aside aria-label="On this page"><h2>Use this playbook</h2><ul>{''.join('<li>'+link('#'+a,n)+'</li>' for a,n in [('answer','The decision'),('context','Service and buyer context'),('worksheet','Working example'),('implementation','Implementation steps'),('editor','Customize and export'),('measurement','Review the result'),('sources','Reference and related pages')])}</ul><p class="pb-definition">{H(s['short'])}<br>{H(g['name'])}<br>{H(t['group'])}</p>{link('/playbooks/'+s['slug']+'/'+g['slug'],'All tasks for this scenario')}</aside></div>'''
   page(path,title,desc,content,crumb,True,f"{t['title']} · {g['keyword']} {s['short'].lower()}")
   main_text=re.sub('<[^>]+>',' ',re.sub(r'<script[\s\S]*?</script>','',content));words=re.findall(r"[\w’-]+",html.unescape(main_text))
   inventory.append(dict(url=HOST+path,path=path,primary_keyword=keyword,title=title,intent='informational / practical worksheet',service=s['name'],segment=g['name'],task=t['title'],keyword_data='proposed target; volume and difficulty not verified',word_count=len(words),body_sha256=hashlib.sha256(content.encode()).hexdigest()))

def hub(path,title,desc,cards,breadcrumb,extra=''):
 content=f'<div class="pb-hero"><div class="pb-wrap">{crumbs(breadcrumb[:-1])}<p class="pb-kicker">Restoration marketing library</p><h1>{H(title)}</h1><p class="pb-lead">{H(desc)}</p></div></div><div class="pb-wrap"><section><div class="pb-filter"><label for="library-filter">Filter the topics on this page</label><input id="library-filter" type="search" data-playbook-filter placeholder="Search these topics"><p class="pb-status" data-filter-status role="status"></p></div><div class="pb-grid">{cards}</div></section>{extra}</div>'
 page(path,title,desc,content,breadcrumb)
for s in SERVICES:
 scards=''.join(card('/playbooks/'+s['slug']+'/'+g['slug'],g['name'].capitalize(),f"Marketing tasks for the {g['buyer']}: {g['priority']}.",'40 practical worksheets') for g in SEGMENTS)
 hub('/playbooks/'+s['slug'],s['short']+' marketing playbooks',f"Choose a property audience to explore specific marketing tasks for {s['name']}. Each task includes a working example and editable worksheet.",scards,[('/','Home'),('/playbooks','Playbooks'),('/playbooks/'+s['slug'],s['short'])])
 for g in SEGMENTS:
  cards=''.join(card(path_for(s,g,t),t['title'],t['goal'],t['group']) for t in TASKS)
  hub('/playbooks/'+s['slug']+'/'+g['slug'],f"{s['short']} marketing for {g['name']}",f"Choose the task you need to complete. These 40 resources address {s['name']} marketing with the {g['buyer']} and {g['priority']} in mind.",cards,[('/','Home'),('/playbooks','Playbooks'),('/playbooks/'+s['slug'],s['short']),('/playbooks/'+s['slug']+'/'+g['slug'],g['name'])])
for t in TASKS:
 cards=''.join(card(path_for(s,g,t),f"{s['short']} · {g['name']}",f"Apply {t['title'].lower()} to the {g['buyer']} scenario.",g['keyword'].capitalize()) for s in SERVICES for g in SEGMENTS)
 hub('/playbooks/topics/'+t['slug'],t['title']+' for restoration companies',t['goal']+' Choose the service and property context that matches your business.',cards,[('/','Home'),('/playbooks','Playbooks'),('/playbooks/topics/'+t['slug'],t['title'])])
rootcards=''.join(card('/playbooks/'+s['slug'],s['short']+' marketing',s['angle'],'400 worksheets · 10 property audiences') for s in SERVICES)
tasklinks=''.join('<li>'+link('/playbooks/topics/'+t['slug'],t['title'])+'</li>' for t in TASKS)
hub('/playbooks','Restoration marketing playbooks','A working library of 4,000 task-specific marketing worksheets across 10 restoration specialties and 10 property audiences. Choose a specialty or browse by task to get an example, implementation steps, and an editable working copy.',rootcards,[('/','Home'),('/playbooks','Playbooks')],'<section><h2>Browse by marketing task</h2><ul>'+tasklinks+'</ul></section><section><h2>What this library is for</h2><p>Use these resources to plan, brief, review, and measure actual marketing work. The examples are proposed starting points, not search-volume data or promised outcomes. Each worksheet includes service boundaries, buyer coordination needs, and a reference relevant to the task.</p></section>')
assert len(inventory)==4000
assert len(pages)==4151
with (ROOT/'content-engine/keyword-inventory.csv').open('w',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=inventory[0].keys());writer.writeheader();writer.writerows(inventory)
(ROOT/'content-engine/inventory.json').write_text(json.dumps(inventory,indent=2))
# Sitemap index and bounded chunks describe the actual deployed host, not the separate .com site.
chunks=[pages[i:i+500] for i in range(0,len(pages),500)]
for i,chunk in enumerate(chunks,1):
 xml='<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+''.join('<url><loc>'+H(HOST+p)+'</loc><lastmod>'+DATE+'</lastmod></url>' for p in chunk)+'</urlset>'
 (ROOT/f'sitemap-playbooks-{i}.xml').write_text(xml)
(ROOT/'sitemap-playbooks.xml').write_text('<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+''.join(f'<sitemap><loc>{HOST}/sitemap-playbooks-{i}.xml</loc><lastmod>{DATE}</lastmod></sitemap>' for i in range(1,len(chunks)+1))+'</sitemapindex>')
r=(ROOT/'robots.txt').read_text();line=f'Sitemap: {HOST}/sitemap-playbooks.xml'
if line not in r:(ROOT/'robots.txt').write_text(r.rstrip()+'\n\n# Marketing playbook library on this deployment\n'+line+'\n')
# A prominent discovery path from the homepage and resources page.
for f in [ROOT/'index.html',ROOT/'live-design/overrides/src/pages/index.astro']:
 st=f.read_text();st=st.replace('href="/resources/">Read our resources →','href="/playbooks">Browse marketing playbooks →');f.write_text(st)
rp=ROOT/'resources/index.html';st=rp.read_text()
if 'data-playbook-library-link' not in st:
 st=st.replace('<main class="legacy-content">','<main class="legacy-content"><section data-playbook-library-link style="padding:32px 24px;background:#0a1a2f;color:white;text-align:center"><h2 style="color:white">Restoration marketing playbook library</h2><p>4,000 practical worksheets organized by specialty, buyer audience, and marketing task.</p><a href="/playbooks" style="color:#fb993e;font-weight:700;text-decoration:underline">Explore the marketing playbooks →</a></section>')
 rp.write_text(st)
(ROOT/'content-engine/build-summary.json').write_text(json.dumps({'content_pages':4000,'navigation_hubs':151,'total_new_pages':4151,'sitemap_chunks':len(chunks),'canonical_origin':HOST,'date':DATE,'min_main_words':min(i['word_count'] for i in inventory),'max_main_words':max(i['word_count'] for i in inventory),'unique_main_body_hashes':len(set(i['body_sha256'] for i in inventory))},indent=2))
print((ROOT/'content-engine/build-summary.json').read_text())
