"""Build the private sales-review dataset from JSON receipts on stdin."""
import collections
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone, timedelta
from decimal import Decimal, ROUND_HALF_UP

docs = json.load(sys.stdin)
def classify(name):
 s=unicodedata.normalize('NFC',name).strip().lower();s=re.sub(r'\s+',' ',s)
 sig=bool(re.search(r'sigenergy|sigen|ซิกเอน|ซิเจน',s))
 if sig:
  brand='Sigenergy';confidence='ชื่อระบุ Sigenergy / Sigen'
  if re.search(r'dummy|ตัวอย่าง',s):cat='Sigenergy · ตัวอย่าง / Dummy'
  elif re.search(r'installation|mount|cable|terminator|coupler|tool|base|connector|kit',s):cat='Sigenergy · อุปกรณ์/ชุดติดตั้ง'
  elif re.search(r'evdc|evac|charger',s):cat='Sigenergy · EV Charger'
  elif re.search(r'sensor|meter|\bct\b',s):cat='Sigenergy · Sensor / Meter'
  elif re.search(r'gateway',s):cat='Sigenergy · Gateway'
  elif re.search(r'\bbat\b|battery|แบต',s):cat='Sigenergy · Battery'
  elif re.search(r'hybrid|micro|controller|\bec\b|\bbc\b|\bpv\b|neo.*\d.*[st]p',s):cat='Sigenergy · Inverter / Controller'
  else:cat='Sigenergy · อื่น ๆ'
 elif re.search(r'\bsig\b|ซิก',s):brand='รอยืนยัน Sigenergy';cat='รอยืนยัน · มีคำว่า SIG';confidence='คำย่อยังระบุยี่ห้อไม่ได้แน่ชัด'
 elif re.search(r'ja\s*solar|^jam\d',s):brand='JA Solar';cat='แผงโซลาร์';confidence='ชื่อยี่ห้อ / ตระกูลรุ่น JAM'
 elif re.search(r'canadian|^cs\d',s):brand='Canadian Solar';cat='แผงโซลาร์';confidence='ชื่อยี่ห้อ / ตระกูลรุ่น CS'
 elif re.search(r'and\s*solar|amcp|amck|adcu|aess',s):brand='AndSolar';cat='Optimizer / Rapid Shutdown';confidence='ชื่อยี่ห้อ / ตระกูลรุ่น ต้องยืนยันรุ่นที่มีแต่คำย่อ'
 elif re.search(r'jinko|longi|trina|risen|astronergy',s):
  brand=next(x for x in ['jinko','longi','trina','risen','astronergy'] if x in s).title();cat='แผงโซลาร์';confidence='ชื่อยี่ห้อ'
 elif re.search(r'มัดจำ|deposit|ชำระล่วงหน้า|เงินล่วงหน้า',s):brand='ไม่ใช่รายการสินค้า';cat='มัดจำ/รับเงินล่วงหน้า';confidence='ระบุในชื่อรายการ'
 elif re.search(r'ขนส่ง|ค่ารถ|shipping|delivery|freight',s):brand='ไม่ใช่รายการสินค้า';cat='ขนส่ง/บริการ';confidence='ระบุในชื่อรายการ'
 elif re.search(r'dc.?cable|สายไฟ|\bmm2\b|\bmm\.2\b|pv.?cable',s):brand='ไม่ระบุยี่ห้อ';cat='สายไฟ/สาย DC';confidence='จัดตามข้อความ ไม่ได้ยืนยันยี่ห้อ'
 elif re.search(r'clamp|rail|grounding|lug|clip|hook|feet|bolt|screw|nut|washer|^tl-|mount|splice|connector|mc4',s):brand='ไม่ระบุยี่ห้อ';cat='โครงสร้าง/อุปกรณ์ติดตั้ง';confidence='จัดตามข้อความ ไม่ได้ยืนยันยี่ห้อ'
 elif any(b in s for b in ['huawei','growatt','sungrow','deye','goodwe','solis','sofar','hoymiles']):
  brand=next(b for b in ['huawei','growatt','sungrow','deye','goodwe','solis','sofar','hoymiles'] if b in s).title();cat='Inverter / ระบบไฟฟ้าอื่น';confidence='ชื่อยี่ห้อ'
 elif not s:brand='ระบุไม่ได้';cat='ไม่มีชื่อสินค้า';confidence='ต้องตรวจเอกสาร'
 else:brand='ระบุไม่ได้';cat='อื่น ๆ / รอจัดหมวด';confidence='ต้องตรวจชื่อและรุ่น'
 return brand,cat,confidence
D=lambda v:Decimal(str(v)) if v not in (None,'') else None
rows=[];catalog={};reconciliation=[]
for d in docs:
 items=d['items'];totals=[D(i.get('total')) for i in items];base=D(d.get('totalWithoutVat'));rawsum=sum((v for v in totals if v is not None),Decimal(0));alloc=[None]*len(items)
 valid=all(v is not None and v>=0 for v in totals) and base is not None and base>=0
 if valid and rawsum>0:
  cents=int((base*100).quantize(Decimal(1),rounding=ROUND_HALF_UP));parts=[v/rawsum*cents for v in totals];whole=[int(v) for v in parts];diff=cents-sum(whole)
  for j in sorted(range(len(parts)),key=lambda j:parts[j]-whole[j],reverse=True)[:diff]:whole[j]+=1
  alloc=[v/100 for v in whole];assert sum(whole)==cents
 elif valid and base==0:alloc=[0]*len(items)
 status=str(d.get('statusString',''));excluded=d.get('isDelete') in (True,'true') or status in ['void','awaiting']
 for index,i in enumerate(items):
  name=str(i.get('name') or '').strip();key=unicodedata.normalize('NFKC',name).casefold();key=re.sub(r'\s+',' ',key);brand,cat,reason=classify(name)
  if key not in catalog:catalog[key]={'name':name,'brand':brand,'category':cat,'reason':reason,'variants':set(),'ids':set()}
  catalog[key]['variants'].add(str(i.get('name') or ''));catalog[key]['ids'].add(str(i.get('id') or 'ไม่มีรหัส'))
  # Keep source amounts and IDs without any credential or contact PII other than customer company.
  rows.append([str(d['documentId']),str(d.get('documentSerial','')),str(d.get('publishedOn') or d.get('documentDate') or '')[:10],re.sub(r'\s+',' ',str(d.get('salesName') or '').strip()) or 'ไม่ระบุเซลส์',str(d.get('contactName') or ''),key,name,brand,cat,float(D(i.get('quantity')) or 0),str(i.get('unitName') or ''),float(totals[index]) if totals[index] is not None else None,alloc[index],status,excluded,float(rawsum),float(base) if base is not None else None,str(i.get('description') or ''),float(D(d.get('discountAmount')) or 0),float(D(d.get('documentDeductionAmount')) or 0)])
 if valid and alloc and alloc[0] is not None:reconciliation.append(d['documentId'])
products=[dict(key=k,**{**v,'variants':sorted(v['variants']),'ids':sorted(v['ids'])}) for k,v in catalog.items()]
dates = [row[2] for row in rows if row[2]]
bangkok = timezone(timedelta(hours=7))
loaded_at = datetime.now(bangkok)
meta = {
    'documents': len(docs),
    'rows': len(rows),
    'rawNames': len({str(item.get('name') or '').strip() for doc in docs for item in doc['items']}),
    'products': len(products),
    'start': min(dates, default='—'),
    'end': max(dates, default='—'),
    'loaded': loaded_at.strftime('%d/%m/%Y %H:%M') + ' (เวลาไทย)',
    'loadedAt': loaded_at.isoformat(),
    'reconciled': len(reconciliation),
    'unknownFinancialDocs': len(docs) - len(reconciliation),
}
json.dump({'meta': meta, 'rows': rows, 'products': products}, sys.stdout,
          ensure_ascii=True, allow_nan=False, separators=(',', ':'))
