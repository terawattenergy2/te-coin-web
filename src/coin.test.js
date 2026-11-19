import {calculate,defaults,rewardCost} from './coin';
import {customerMetric} from './formulas';
test('commission is based on actual sale; B is chosen by product group',()=>{
 const result=calculate({product:'SigenStor Battery',tier_2_price:72600,epc_price:84500},4,defaults,{sale_unit_price:82700});
 expect(result.commission*4).toBe(4962);expect(result.gross*4).toBe(35438);expect(result.tc).toBe(17719);
 const changed={...defaults,membership_config:{...defaults.membership_config,groups:{'SigenStor Battery':{b:.2}}}};
 expect(calculate({product:'SigenStor Battery',tier_2_price:72600,epc_price:84500},4,changed,{sale_unit_price:82700}).tc).toBe(7087.6);
});
test('all three case bills sum to 83489.20 TC, with separate group B and commission',()=>{
 const line=(product,cost,price,qty,rate=.015)=>calculate({product,tier_2_price:cost,epc_price:price},qty,defaults,{sale_unit_price:price,commission_rate:rate}).tc;
 const bill1=line('SigenStor Battery',72600,82700,4);
 const bill2=line('SigenStor Neo Inverter',39300,44000,1,.012)+line('SigenStor Neo Battery',51800,58000,4,.012);
 const bill3=line('SigenStor Inverter',93700,106900,2)+line('SigenStor Battery',72600,82700,10);
 expect(bill1).toBe(17719);expect(bill2).toBeCloseTo(5237.6,2);expect(bill3).toBeCloseTo(60532.6,2);expect(bill1+bill2+bill3).toBeCloseTo(83489.2,2);
});
test('imported comma prices work, losses give zero, rounding happens at end of line',()=>{
 expect(calculate({tier_2_price:'74,400.00',epc_price:'81,300.00'},1,defaults).tc).toBe(2840.25);
 expect(calculate({tier_2_price:100,epc_price:80},1,defaults).tc).toBe(0);
 expect(calculate({tier_2_price:1,epc_price:2},3,defaults).tc).toBe(1.46);
});
test('reward value multiplies B; reserve does not change reward price',()=>{
 const tour={option:4,value_baht:55000,redemption_b:.8};expect(rewardCost(tour,defaults)).toBe(44000);
 expect(rewardCost(tour,{...defaults,baht_per_tc:.9})).toBe(44000);
 expect(rewardCost({option:2,value_baht:800},{...defaults,membership_config:{...defaults.membership_config,reward_b:{2:1.5}}})).toBe(1200);
 expect(customerMetric('liability_amount',{banlance_tc:20663.11},defaults)).toBe(12397.87);
});
