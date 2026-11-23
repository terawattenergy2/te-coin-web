import {createHash} from 'node:crypto';
import {gzipSync, gunzipSync} from 'node:zlib';

function field(value, maxLength) {
 if (typeof value !== 'string') return '';
 const text = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
 return text.length <= maxLength ? text : '';
}

export function parseProductGroup(input) {
 const name = field(input?.name, 500);
 if (!name || /^[–—-]+$/.test(name)) return null;
 const productKey = name.toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ');
 if (input.reset === true) return {productKey, name, reset: true};
 const brand = field(input.brand, 100);
 const category = field(input.category, 160);
 if (!brand || !category) return null;
 return {productKey, name, brand: brand.toLowerCase() === 'sigenergy' ? 'Sigenergy' : brand, category};
}

export function createProductGroupStore({url, key, source}) {
 const bucket = 'teracoin-sales-review';
 const prefix = `${encodeURIComponent(source)}/product-group-overrides`;
 const headers = {apikey: key};
 if (key?.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;
 const filename = group => createHash('sha256').update(group.productKey).digest('hex') + '.json.gz';

 async function request(path, options = {}) {
  if (!url || !key || !source) throw Error('ยังไม่ได้ตั้งค่าพื้นที่บันทึกหมวดสินค้า');
  const response = await fetch(url + '/storage/v1/object/' + path, {...options,
   headers: {...headers, ...options.headers}, cache: 'no-store', signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw Error(`เข้าถึงพื้นที่บันทึกหมวดสินค้าไม่ได้ (HTTP ${response.status})`);
  return response;
 }

 return {
  async read() {
   const groups = [];
   const limit = 100;
   for (let offset = 0; ; offset += limit) {
    const files = await (await request('list/' + bucket, {
     method: 'POST', headers: {'Content-Type': 'application/json'},
     body: JSON.stringify({prefix, limit, offset, sortBy: {column: 'name', order: 'asc'}}),
    })).json();
    for (let index = 0; index < files.length; index += 12) {
     const batch = files.slice(index, index + 12).filter(file => /^[a-f0-9]{64}\.json\.gz$/.test(file.name));
     const saved = await Promise.all(batch.map(async file => {
      const response = await request(`authenticated/${bucket}/${prefix}/${file.name}?version=${encodeURIComponent(file.updated_at ?? '')}`);
      const group = parseProductGroup(JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()));
      if (!group || filename(group) !== file.name) throw Error('พบข้อมูลหมวดสินค้าที่อ่านไม่ได้');
      return group;
     }));
     groups.push(...saved.filter(group => !group.reset));
    }
    if (files.length < limit) return groups;
   }
  },
  async save(group, userId) {
   await request(`${bucket}/${prefix}/${filename(group)}`, {
    method: 'POST', headers: {'Content-Type': 'application/gzip', 'x-upsert': 'true', 'cache-control': 'max-age=0'},
    body: gzipSync(JSON.stringify({...group, changedBy: userId})),
   });
  },
 };
}
