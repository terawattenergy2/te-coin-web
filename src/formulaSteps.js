import {evaluateTarget} from './formulas';
export const arithmeticSymbols={add:'+',sub:'−',mul:'×',div:'÷'};
export function nodeValue(node,rules,context){return evaluateTarget('__ui_preview__',{...rules,__ui_preview__:node},context);}
const isZero=n=>n&&Object.prototype.hasOwnProperty.call(n,'value')&&Number(n.value)===0;
export function splitFormula(node){
 let body=node,rounding='none',digits=2,nonNegative=false;
 if(['round','ceil','floor'].includes(body.op)&& (body.op!=='round'||(body.args.length===1||('value'in body.args[1]&&Number.isInteger(Number(body.args[1].value))&&Number(body.args[1].value)>=0&&Number(body.args[1].value)<=8)))){
  rounding=body.op;digits=Number(body.args[1]?.value??0);body=body.args[0];
 }
 if(body.op==='max'&&body.args.length===2&&(isZero(body.args[0])||isZero(body.args[1]))){nonNegative=true;body=isZero(body.args[0])?body.args[1]:body.args[0];}
 return{body,rounding,digits,nonNegative};
}
export function joinFormula({body,rounding,digits,nonNegative}){
 let node=body;if(nonNegative)node={op:'max',args:[{value:'0'},node]};
 if(rounding==='round')node={op:'round',args:[node,{value:String(digits)}]};
 else if(rounding!=='none')node={op:rounding,args:[node]};return node;
}
export function formulaSteps(node,path='root',steps=[]){
 for(let i=0;i<(node.args||[]).length;i++)if(node.args[i].op)formulaSteps(node.args[i],`${path}-${i}`,steps);
 if(node.op||path==='root')steps.push({node,path,index:steps.length+1});return steps;
}
export function replaceFormulaNode(root,path,value){
 const indices=path.split('-').slice(1).map(Number);
 function replace(node,depth){if(depth===indices.length)return value;return{...node,args:node.args.map((a,i)=>i===indices[depth]?replace(a,depth+1):a)};}
 return replace(root,0);
}
export function formatExample(value,key=''){
 if(!Number.isFinite(value))return 'ยังไม่มีค่า';
 const fmt=n=>n.toLocaleString('th-TH',{maximumFractionDigits:8});
 if(['commission_rate','success_rate','lucky_rate'].includes(key))return `${fmt(value*100)}% (${fmt(value)})`;
 if(['quantity','Qty','qty'].includes(key))return `${fmt(value)} ชิ้น`;
 if(['y','reward_y','group_multiplier','redemption_b'].includes(key))return fmt(value);
 if(key==='earned_tc'||key.startsWith('reward_tc_')||['balance_tc','total_earn','used_tc'].includes(key))return `${fmt(value)} TC`;
 if(/margin|magin/.test(key)&&key!=='gross_margin')return `${fmt(value)}%`;
 if(/price|cost|profit/.test(key)||['commission_amount','gross_margin','tc_value','liability_amount','value_baht','baht_per_tc','base_cost','redemption_d'].includes(key))return `${fmt(value)} บาท`;
 return fmt(value);
}
