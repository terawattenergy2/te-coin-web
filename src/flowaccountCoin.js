const {matchProduct}=require('./flowaccountDomain');
function previewFlowSale(sale,products,settings){
 let total=0;const errors=[];
 const lines=sale.lines.map(line=>{
  const resolved=matchProduct(line,products),p=resolved.product;
  if(!p){errors.push(line.name+': '+resolved.error);return {...line,tc:null,error:resolved.error};}
  const costColumn=settings.membership_config?.base_cost_column||'tier_2_price';
  if(p[costColumn]==null||!Number.isFinite(Number(p[costColumn]))||Number(p[costColumn])<0){errors.push('ไม่พบต้นทุน '+line.name);return {...line,tc:null,error:'ยังไม่มีต้นทุน จึงยังคำนวณไม่ได้'};}
  const price=line.netTotal/line.quantity;
  const group=settings.membership_config?.groups?.[p.product]||{};
  const multiplier=Number(group.b??settings.y??0.5),commissionRate=Number(group.commission??settings.commission??0.015);
  if(!Number.isFinite(multiplier)||multiplier<0||multiplier>100||!Number.isFinite(commissionRate)||commissionRate<0||commissionRate>1){errors.push('ค่าตัวคูณหรือคอมมิชชันไม่ถูกต้อง');return {...line,tc:null,error:'กรุณาตรวจค่าตัวคูณ B และคอมมิชชัน'};}
  const cost=Number(p[costColumn]);
  if(cost===0){errors.push('ยังไม่มีต้นทุน '+line.name);return {...line,tc:null,error:'ต้นทุนในตารางเป็น 0 ต้องตรวจต้นทุนก่อนคำนวณ'};}
  const commission=price*commissionRate,gross=price-cost-commission;
  const tc=Math.round((Math.max(0,gross*line.quantity*multiplier)+Number.EPSILON)*100)/100;
  total+=tc;
  return {...line,tc,price,cost,commission,gross,multiplier,commissionRate,group:p.product,model:p.model};
 });
 return {lines,errors,partial:errors.length>0,tc:Math.round(total*100)/100};
}
module.exports={previewFlowSale};
