import {randomUUID} from 'node:crypto';
import {gzipSync, gunzipSync} from 'node:zlib';

export function parseSellerGroup(input) {
 const canonical = typeof input?.canonical === 'string' ? input.canonical.trim() : '';
 if (!Array.isArray(input?.names) || input.names.length > 100 ||
     input.names.some(name => typeof name !== 'string' || !name.trim() || name.length > 180)) return null;
 const names = [...new Set(input.names.map(name => name.trim()))];
 return names.length > 1 && names.includes(canonical) ? {canonical, names} : null;
}

export function mergeSellerGroups(events) {
 const groups = [];
 for (const {canonical, names} of events) {
  const members = new Set(names);
  for (let i = groups.length - 1; i >= 0; i--) {
   if (!groups[i].names.some(name => members.has(name))) continue;
   for (const name of groups[i].names) members.add(name);
   groups.splice(i, 1);
  }
  groups.push({canonical, names: [...members]});
 }
 return groups;
}

export function createSellerGroupStore({url, key, source}) {
 const bucket = 'teracoin-sales-review';
 const prefix = `${encodeURIComponent(source)}/seller-confirmations/`;
 const root = url + '/storage/v1/object/';
 const headers = {apikey: key};
 if (key?.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;
 const eventName = /^\d{13}-[a-f0-9-]{36}\.json\.gz$/;

 async function request(path, options = {}) {
  if (!url || !key || !source) throw Error('ยังไม่ได้ตั้งค่าพื้นที่บันทึกการรวมชื่อเซลส์');
  const response = await fetch(root + path, {...options, headers: {...headers, ...options.headers},
   cache: 'no-store', signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw Error(`เข้าถึงพื้นที่บันทึกชื่อเซลส์ไม่ได้ (HTTP ${response.status})`);
  return response;
 }

 return {
  async read() {
   const events = [];
   const limit = 100;
   for (let offset = 0; ; offset += limit) {
    const list = await (await request('list/' + bucket, {
     method: 'POST', headers: {'Content-Type': 'application/json'},
     body: JSON.stringify({prefix: prefix.slice(0, -1), limit, offset, sortBy: {column:'name', order:'asc'}}),
    })).json();
    for (let i = 0; i < list.length; i += 10) {
     const batch = list.slice(i, i + 10).filter(item => eventName.test(item.name));
     events.push(...await Promise.all(batch.map(async ({name}) => {
      const response = await request(`authenticated/${bucket}/${prefix}${name}`);
      const group = parseSellerGroup(JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8')));
      if (!group) throw Error('พบข้อมูลการรวมชื่อเซลส์ที่อ่านไม่ได้');
      return group;
     })));
    }
    if (list.length < limit) return mergeSellerGroups(events);
   }
  },
  async confirm(group, userId) {
   const name = `${Date.now()}-${randomUUID()}.json.gz`;
   await request(`${bucket}/${prefix}${name}`, {
    method: 'POST', headers: {'Content-Type':'application/gzip', 'cache-control':'max-age=0'},
    body: gzipSync(JSON.stringify({...group, confirmedBy:userId})),
   });
  },
 };
}
