// Display names only. Original Supabase field names and values stay intact.
const definitions = [
 ['main','หมวดหมู่หลัก (Main)','main',['main','main_category']],
 ['product','กลุ่มสินค้า (Products)','main',['product','products','product_group']],
 ['model','รหัสรุ่น (Model)','main',['model']],
 ['qty','จำนวนในสต็อก (Qty)','cost',['qty','quantity','stock_qty']],
 ['tier_2_price','ราคา Tier 2 ปกติ','cost',['tier_2_price','tier2_price']],
 ['tier_2_cost','ต้นทุนฐาน (Tier 2)','cost',['tier_2_cost','tier2_cost']],
 ['epc_price','ราคาขาย EPC','epc',['epc_price','price_epc']],
 ['epc_unit_profit','กำไร EPC / หน่วย','epc',['epc_profit','profit_epc','epc_profit_per_unit','epc_unit_profit','profit_epc_per_unit','epc_profit_unit']],
 ['epc_margin','Margin % (EPC)','epc',['epc_margin','margin_epc','epc_margin_percent','margin_percent_epc']],
 ['epc_total_profit','กำไรรวมสต็อก EPC','epc',['epc_total_profit','total_profit_epc','epc_stock_profit','total_epc_profit']],
 ['enduser_price','ราคาขาย Enduser','enduser',['enduser_price','end_user_price','price_enduser']],
 ['enduser_unit_profit','กำไร Enduser / หน่วย','enduser',['enduser_profit','profit_enduser','enduser_profit_per_unit','enduser_unit_profit','end_user_profit']],
 ['enduser_margin','Margin % (Enduser)','enduser',['enduser_margin','margin_enduser','enduser_margin_percent','end_user_margin']],
 ['enduser_total_profit','กำไรรวมสต็อก Enduser','enduser',['enduser_total_profit','total_profit_enduser','enduser_stock_profit','total_enduser_profit']],
 ['total_stock_cost','มูลค่าสต็อกต้นทุนรวม','main',['total_stock_cost','stock_cost_total','total_cost','stock_value','total_stock_value','total_inventory_cost','stock_cost']],
];
export function stockHeader(key) {
 const normalized=key.toLowerCase().replace(/[\s-]+/g,'_').replace(/magin/g,'margin');
 let found=definitions.find(d=>d[3].includes(normalized));
 if(!found){
  const compact=normalized.replace(/_/g,'');
  const channel=compact.includes('enduser')?'enduser':compact.includes('epc')?'epc':null;
  if(channel){
   const part=compact.includes('margin')?'margin':compact.includes('price')?'price':compact.includes('profit')?(compact.includes('total')||compact.includes('stock')?'total_profit':'unit_profit'):null;
   if(part)found=definitions.find(d=>d[0]===`${channel}_${part}`);
  } else if((compact.includes('stock')||compact.includes('total'))&&compact.includes('cost'))found=definitions[14];
 }
 return found?{label:found[1],group:found[2],order:definitions.indexOf(found)}:{label:normalized==='active'?'สถานะสินค้า':key,group:'main',order:definitions.length};
}
