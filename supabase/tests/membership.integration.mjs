import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url); 
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth,public to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
for(const file of ['001_teracoin.sql','002_customer_pricing.sql','004_configurable_formulas.sql','005_reward_tc_indicators.sql','006_membership_model.sql']){try{await db.exec((await readFile(new URL(file,root),'utf8')).replace('create extension if not exists pgcrypto;',''));console.log('Installed',file);}catch(e){console.error('Failed',file,e.message);throw e;}}
const admin='11111111-1111-4111-8111-111111111111',customer='22222222-2222-4222-8222-222222222222';
await db.query(`insert into auth.users(id,email) values ($1,'admin@example.test'),($2,'customer@example.test')`,[admin,customer]);
await db.query(`update tc_profiles set role='admin' where id=$1`,[admin]);
const customerId=(await db.query('select customer_id from tera_coin_customer where auth_user_id=$1',[customer])).rows[0].customer_id;
const productRows=[['BAT10','SigenStor Battery',72600,82700,50],['NEO10','SigenStor Neo Inverter',39300,44000,10],['NEOBAT8','SigenStor Neo Battery',51800,58000,20],['EC25','SigenStor Inverter',93700,106900,10]];
const ids={};for(const [model,group,cost,price,qty] of productRows){ids[model]=(await db.query('insert into stock_profit(main,product,model,"Qty",tier_2_price,tier_2_cost,epc_price) values(\'Resi\',$1,$2,$3,$4,$4,$5) returning id',[group,model,qty,cost,price])).rows[0].id;}
await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';`);
let count=0;const ok=(actual,expected,label)=>{assert.equal(Number(actual),expected,label);count++;};
const sale=async(ref,lines)=>{const items=lines.map(([m,q,price,rate])=>({product_id:ids[m],quantity:q,sale_unit_price:price,commission_rate:rate}));return (await db.query('select tc_record_sale($1,$2,$3::jsonb,gen_random_uuid()) as result',[customerId,ref,JSON.stringify(items)])).rows[0].result;};
const a=await sale('case1',[['BAT10',4,82700,.015]]);ok(a.tc,17719,'battery earning');ok(a.gross_margin_a,35438,'battery A');
const b=await sale('case2',[['NEO10',1,44000,.012],['NEOBAT8',4,58000,.012]]);ok(b.tc,5237.6,'mixed group bill');ok(b.gross_margin_a,26188,'mixed A');
const c=await sale('case3',[['EC25',2,106900,.015],['BAT10',10,82700,.015]]);ok(c.tc,60532.6,'inverter+battery bill');ok(c.gross_margin_a,111788,'third A');
let row=(await db.query('select * from tera_coin_customer where customer_id=$1',[customerId])).rows[0];ok(row.total_earn,83489.2,'total');ok(row.liability,50093.52,'reserve');
const before=(await db.query('select sum("Qty") as q from stock_profit')).rows[0].q;
try{await sale('rollback',[['BAT10',1,82700,.015],['EC25',9999,106900,.015]]);assert.fail('must reject stock');}catch(e){assert.match(e.message,/Insufficient stock/);count++;}
ok((await db.query('select sum("Qty") as q from stock_profit')).rows[0].q,Number(before),'stock rollback');
try{await sale('case1',[['BAT10',1,82700,.015]]);assert.fail('must reject duplicate');}catch(e){assert.match(e.message,/unique/);count++;}
ok((await db.query('select sum("Qty") as q from stock_profit')).rows[0].q,Number(before),'duplicate rollback');
// Preserve the exact original ledger snapshot when B and reserve change.
const snap=JSON.stringify((await db.query("select snapshot from tc_ledger where reference='case1'")).rows[0]);
await db.query(`update tc_settings set membership_config=jsonb_set(membership_config,'{groups,SigenStor Battery,b}','0.25'),baht_per_tc=0.7 where id=1`);
assert.equal(JSON.stringify((await db.query("select snapshot from tc_ledger where reference='case1'")).rows[0]),snap);count++;
ok((await db.query('select total_earn from tera_coin_customer where customer_id=$1',[customerId])).rows[0].total_earn,83489.2,'points frozen');
await db.exec('update tc_settings set baht_per_tc=0.6 where id=1');
const tour=(await db.query('select id from tc_rewards where option=4')).rows[0].id;
await db.exec(`reset role;`);
// A 15,750 baht reward at D=1.05 models a 15,000 TC redemption.
const bundle=(await db.query("insert into tc_rewards(option,name,value_baht,redemption_d,stock) values(1,'Case redemption',15750,1.05,10) returning id")).rows[0].id;
await db.exec(`set role authenticated;set request.jwt.claim.sub='${customer}';`);
for(const [id,expected]of [[bundle,15000],[tour,47826.09]]){const r=(await db.query('select tc_redeem($1,gen_random_uuid()) as result',[id])).rows[0].result;ok(r.spent_tc,expected,'redemption D');}
row=(await db.query('select * from tera_coin_customer where customer_id=$1',[customerId])).rows[0];ok(row.banlance_tc,20663.11,'remaining');ok(row.liability,12397.87,'remaining reserve');
try{await sale('customer-attack',[['BAT10',1,82700,.015]]);assert.fail('must reject customer');}catch(e){assert.match(e.message,/Admin only/);count++;}
await db.query(`update tc_settings set membership_config='{}' where id=1`); // RLS silently updates zero rows.
assert.equal((await db.query('select membership_config from tc_settings')).rows[0].membership_config.base_cost_column,'tier_2_price');count++;
assert.equal((await db.query('select * from stock_profit')).rows.length,0);count++;
await db.exec('reset role');
const previous=(await db.query('select membership_config from tc_settings')).rows[0].membership_config;
await db.exec(await readFile(new URL('006_membership_model.sql',root),'utf8'));
assert.deepEqual((await db.query('select membership_config from tc_settings')).rows[0].membership_config,previous);count++;
ok((await db.query('select total_earn from tera_coin_customer where customer_id=$1',[customerId])).rows[0].total_earn,83489.2,'rerun does not reset');
console.log('PASS',count,'database checks');await db.close();
