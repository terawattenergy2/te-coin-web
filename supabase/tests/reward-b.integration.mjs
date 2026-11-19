import {PGlite} from '@electric-sql/pglite';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
async function run(with006){const db=new PGlite();let checks=0;
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth,public to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
for(const file of ['001_teracoin.sql','002_customer_pricing.sql','004_configurable_formulas.sql',...(with006?['005_reward_tc_indicators.sql','006_membership_model.sql']:[]),'007_reward_multipliers.sql'])await db.exec((await readFile(new URL(file,root),'utf8')).replace('create extension if not exists pgcrypto;',''));
const admin='11111111-1111-4111-8111-111111111111',cust='22222222-2222-4222-8222-222222222222';await db.query("insert into auth.users(id,email)values($1,'admin@example.test'),($2,'customer@example.test')",[admin,cust]);await db.query("update tc_profiles set role='admin' where id=$1",[admin]);await db.query('update tera_coin_customer set total_earn=100000 where auth_user_id=$1',[cust]);
const earned=(await db.query("select tc_formula_result('earned_tc',s.formulas,tc_formula_context(jsonb_build_object('product','SigenStor Battery','tier_2_price',72600,'epc_price',84500),to_jsonb(s),jsonb_build_object('sale_unit_price',82700,'quantity',4))) as tc from tc_settings s")).rows[0].tc;assert.equal(Number(earned),17719);checks++;
const old=(await db.query('select * from tc_settings')).rows[0];assert.equal(old.reward_formula_version,1);checks++;
await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}'`);
const bs={'1':.5,'2':1.5,'3':2,'4':.8};const rev=(await db.query('select tc_save_reward_formulas($1::jsonb,$2::jsonb,$3) as rev',[JSON.stringify(old.formulas),JSON.stringify(bs),old.formula_revision])).rows[0].rev;assert.equal(Number(rev),Number(old.formula_revision)+1);checks++;
// Verify the expected four independent multipliers through actual customer redemptions.
const rewards=(await db.query('select id,option,value_baht from tc_rewards order by option')).rows;
await db.exec(`reset role`);await db.query('update tc_rewards set win_rate=1 where option=3');
await db.exec(`set role authenticated;set request.jwt.claim.sub='${cust}'`);
for(const r of rewards){const result=(await db.query('select tc_redeem($1,gen_random_uuid()) as result',[r.id])).rows[0].result;assert.equal(Number(result.spent_tc),Number(r.value_baht)*bs[r.option]);checks++;}
const snap=(await db.query('select snapshot from tc_ledger order by created_at')).rows.map(x=>JSON.stringify(x));const totals=(await db.query('select total_earn,used_tc from tera_coin_customer where auth_user_id=$1',[cust])).rows[0];
try{await db.query('select tc_save_reward_formulas($1::jsonb,$2::jsonb,$3)',[JSON.stringify(old.formulas),JSON.stringify(bs),rev]);assert.fail();}catch(e){assert.match(e.message,/Admin only/);checks++;}
await db.exec(`set request.jwt.claim.sub='${admin}'`);
for(const bad of [{'1':0,'2':1,'3':1,'4':1},{'1':1,'2':1,'3':1},null]){try{await db.query('select tc_save_reward_formulas($1::jsonb,$2::jsonb,$3)',[JSON.stringify(old.formulas),JSON.stringify(bad),rev]);assert.fail('invalid B accepted');}catch(e){assert.match(e.message,/reward B|group settings|not-null/);checks++;}}
try{await db.query('select tc_save_reward_formulas($1::jsonb,$2::jsonb,$3)',[JSON.stringify(old.formulas),JSON.stringify(bs),old.formula_revision]);assert.fail();}catch(e){assert.match(e.message,/changed by another admin/);checks++;}
// Per-reward B overrides its type default. Admin edits only, server applies it.
await db.query('update tc_rewards set redemption_b=.8 where option=2');await db.exec(`set request.jwt.claim.sub='${cust}'`);const result=(await db.query('select tc_redeem($1,gen_random_uuid()) as result',[rewards[1].id])).rows[0].result;assert.equal(Number(result.spent_tc),640);checks++;
await db.exec('reset role');await db.exec(await readFile(new URL('007_reward_multipliers.sql',root),'utf8'));
assert.deepEqual((await db.query('select membership_config from tc_settings')).rows[0].membership_config.reward_b,bs);checks++;
assert.equal((await db.query('select redemption_b from tc_rewards where option=2')).rows[0].redemption_b,'0.800000');checks++;
const now=(await db.query('select snapshot from tc_ledger order by created_at')).rows.map(x=>JSON.stringify(x));assert.deepEqual(now.slice(0,4),snap);checks++;
assert.equal((await db.query('select total_earn from tera_coin_customer where auth_user_id=$1',[cust])).rows[0].total_earn,totals.total_earn);checks++;
console.log(`PASS ${checks} database checks (${with006?'upgrade from 006':'directly from 004'})`);await db.close();}
await run(false);await run(true);
