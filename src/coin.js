/* global BigInt */
import {
  resultFor,
  formulaContext,
  formulaRules,
  evaluateTarget,
  round,
  printFormula,
} from "./formulas";
export const defaults = {
  y: 0.5,
  commission: 0.015,
  baht_per_tc: 0.6,
  success_rate: 0.8,
  membership_version: 2,
  reward_formula_version: 1,
  membership_config: {reward_b:{1:1,2:1,3:1,4:1},base_cost_column:"tier_2_price",groups:{"SigenStor Battery":{b:0.5},"SigenStor Inverter":{b:0.7},"SigenStor Neo Inverter":{b:0.2},"SigenStor Neo Battery":{b:0.2}}},
};
export const number = (value) =>
  Number(String(value ?? 0).replace(/,/g, "")) || 0;
export function calculate(product, qty = 1, settings = defaults, inputs = {}) {
  const tier = number(product.tier_2_price),
    epc = number(product.epc_price);
  if (product.tier_2_price == null && product.epc_price == null)
    return { tier, epc, commission: 0, gross: 0, tc: 0 };
  try {
    const ctx = formulaContext(product, settings, { ...inputs, quantity: number(qty) }),
      rules = formulaRules(settings);
    const commission = evaluateTarget("commission_amount", rules, ctx),
      gross = evaluateTarget("gross_margin", rules, ctx),
      tc = round(evaluateTarget("earned_tc", rules, ctx), 2);
    if (tc < 0) throw Error("TC ที่ได้รับต้องไม่ติดลบ");
    return { tier, epc, commission, gross, tc };
  } catch (e) {
    return { tier, epc, commission: 0, gross: 0, tc: 0, error: e.message };
  }
}
export const defaultD = {1:1.05,2:0.50,3:0.75,4:1.15};
export function rewardD(reward){return number(reward.redemption_d??defaultD[reward.option||1]);}
// Older databases can persist a type B as a numeric constant in the existing safe formula AST.
export function formulaRewardB(node){
 if(!node)return null;
 if(['ceil','floor','round'].includes(node.op))return formulaRewardB(node.args?.[0]);
 if(node.op==='div'&&Number(node.args?.[1]?.value)===100){const c=node.args[0];if(c.op==='ceil'&&c.args[0]?.op==='mul'&&Number(c.args[0].args[1]?.value)===100)return formulaRewardB(c.args[0].args[0]);}
 if(node.op==='mul')for(const [a,b]of[[node.args[0],node.args[1]],[node.args[1],node.args[0]]])if(a?.var==='value_baht'&&Object.prototype.hasOwnProperty.call(b||{},'value')){const v=Number(b.value);return Number.isFinite(v)&&v>0?v:null;}
 return null;
}
export function rewardTypeB(settings,option){const literal=formulaRewardB(settings?.formulas?.[`reward_tc_${option}`]),configured=settings?.membership_config?.reward_b?.[option];return Number(settings?.reward_formula_version===1?(configured??literal??1):(literal??configured??1));}
export function rewardB(reward,settings){return Number((reward.redemption_b==null||reward.redemption_b==='')?rewardTypeB(settings,reward.option||1):reward.redemption_b);}
export function rewardBase(reward,settings){return number(reward.value_baht)*rewardB(reward,settings);}
// Exact decimal multiplication prevents a floating-point artifact from charging an extra TC cent.
function decimalParts(value){const [mantissa,exp='0']=Number(value).toString().toLowerCase().split('e');const[whole,fraction='']=mantissa.split('.');let coefficient=BigInt(whole+fraction),scale=fraction.length-Number(exp);if(scale<0){coefficient*=BigInt(10)**BigInt(-scale);scale=0;}return{coefficient,scale};}
export function rewardCost(reward,settings){
 if(settings?.formulas&&settings.reward_formula_version!==1){
  const base=reward.tc_base!=null?Number(reward.tc_base):resultFor(`reward_tc_${reward.option||1}`,settings,formulaContext({},settings,{value_baht:number(reward.value_baht),reward_y:number(reward.y??1),redemption_d:rewardD(reward),redemption_b:rewardB(reward,settings)}));
  const indicator=Number(reward.tc_indicator??1);
  if(!Number.isFinite(base)||base<=0||!Number.isFinite(indicator)||indicator<=0)throw Error('สูตร TC หรือค่าที่ตั้งไว้ไม่ถูกต้อง');
  const a=decimalParts(base),m=decimalParts(indicator),n=a.coefficient*m.coefficient,den=BigInt(10)**BigInt(a.scale+m.scale),cost=Number((n+den-BigInt(1))/den);
  if(cost<=0||cost>1e15)throw Error('TC ที่ใช้แลกเกินขอบเขต');return cost;
 }
 const b=rewardB(reward,settings),value=number(reward.value_baht);
 if(!Number.isFinite(b)||b<=0||!Number.isFinite(value)||value<=0)throw Error('มูลค่ารางวัลและ B ต้องมากกว่า 0');
 const rule=settings?.formulas?.[`reward_tc_${reward.option||1}`];
 if(rule && printFormula(rule)!==printFormula(formulaRules({})[`reward_tc_${reward.option||1}`])){
  const cost=resultFor(`reward_tc_${reward.option||1}`,settings,formulaContext({},settings,{value_baht:value,reward_y:number(reward.y??1),redemption_d:rewardD(reward),redemption_b:b}));
  if(!Number.isFinite(cost)||cost<=0||cost>1e15)throw Error('TC ที่ใช้แลกเกินขอบเขต');
  const amount=decimalParts(round(cost,8)),den=BigInt(10)**BigInt(amount.scale),n=amount.coefficient*BigInt(100);
  return Number((n+den-BigInt(1))/den)/100;
 }
 const a=decimalParts(value),m=decimalParts(b),n=a.coefficient*m.coefficient*BigInt(100),den=BigInt(10)**BigInt(a.scale+m.scale);
 const cost=Number((n+den-BigInt(1))/den)/100;
 if(cost<=0||cost>1e15)throw Error('TC ที่ใช้แลกเกินขอบเขต');return cost;
}
export function luckyProbability(settings, reward = {}) {
  return resultFor("lucky_rate", settings, formulaContext({}, settings, {success_rate:number(reward.win_rate??settings.success_rate)}));
}
export const initialProducts = [
  {
    id: "demo-1",
    main: "C&I",
    product: "C&I Inverter",
    model: "Sigen PV 50M1",
    Qty: 2,
    tier_2_price: 74400,
    tier_2_cost: 74400,
    epc_price: 81300,
    enduser_price: 101700,
  },
  {
    id: "demo-2",
    main: "C&I",
    product: "C&I Inverter",
    model: "Sigen PV 110M1",
    Qty: 2,
    tier_2_price: 117400,
    tier_2_cost: 117400,
    epc_price: 128400,
    enduser_price: 160500,
  },
  {
    id: "demo-3",
    main: "Resi",
    product: "SigenStor Inverter",
    model: "SigenStor EC 5.0 SP",
    Qty: 160,
    tier_2_price: 36800,
    tier_2_cost: 36800,
    epc_price: 42900,
    enduser_price: 46400,
  },
];
export const initialRewards = [
  {
    id: "bundle",
    option: 1,
    name: "Bundle Set",
    description: "แลกแต้มเป็นชุดสินค้า Sigenergy",
    value_baht: 4000,
    y: 1,
    stock: 20,
    active: true,
  },
  {
    id: "cashback",
    option: 2,
    name: "Cashback / Voucher",
    description: "ขอรับ Cashback, Credit note หรือเงินส่งเสริมการตลาด",
    value_baht: 800,
    y: 1,
    stock: 100,
    active: true,
  },
  {
    id: "draw",
    option: 3,
    name: "Lucky Draw",
    description: "ลุ้น Voucher มูลค่า 800 บาท • โอกาสสำเร็จ 80%",
    value_baht: 80,
    prize_value_baht: 800,
    prize_name: "Voucher ส่งเสริมการตลาด",
    y: 1,
    stock: 100,
    active: true,
  },
  {
    id: "tour",
    option: 4,
    name: "Sigenergy Discovery",
    description: "ทัวร์โรงงาน • เซี่ยงไฮ้ • ซูโจว / 1 ที่นั่ง",
    value_baht: 55000,
    y: 1,
    stock: 10,
    active: true,
  },
];
