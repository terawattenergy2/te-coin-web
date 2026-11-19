import {previewFlowSale} from './FlowAccountPanel';
import {parseFormula} from './formulas';
const {matchProduct,purchaseLines}=require('./flowaccountDomain');
const product={id:'inverter',active:true,model:'SigenStor EC 10.0 SP',product:'SigenStor Inverter',tier_2_price:60600,epc_price:70600};
const settings={y:0.5,commission:0.015,baht_per_tc:0.8,formulas:{commission_amount:parseFormula('tier_2_price * commission_rate'),gross_margin:parseFormula('epc_price - tier_2_price - commission_amount'),earned_tc:parseFormula('round(max(0,gross_margin * quantity * y),2)')}};
const sale={lines:[{name:'SigenStor EC 10.0 SP',productKey:'id:1',quantity:10,netTotal:764000},{name:'TRINA TSM-NEG19RC.20-635M',productKey:'id:2',quantity:95,netTotal:274478.75},{name:'30mm end clamp',productKey:'id:3',quantity:100,netTotal:420000}]};
test('automatically calculates known purchase from actual selling price with settings formula using sale-based commission',()=>{const p=previewFlowSale(sale,[product],settings);expect(p.tc).toBe(73270);expect(p.lines[0]).toMatchObject({cost:60600,price:76400,commission:1146,gross:14654,tc:73270});});
test('unavailable panel/clamp costs remain unknown rather than using an inverter or producing misleading zero',()=>{const p=previewFlowSale(sale,[product],settings);expect(p.partial).toBe(true);expect(p.lines[1].tc).toBeNull();expect(p.lines[2].tc).toBeNull();expect(p.errors).toHaveLength(2);});
test('matches only the full normalized model and never SP to TP or another capacity',()=>{expect(matchProduct({name:' sigenstor   ec 10.0 SP '},[product]).product.id).toBe('inverter');expect(matchProduct({name:'SigenStor EC 10.0 TP'},[product]).product).toBeNull();expect(matchProduct({name:'SigenStor EC 5.0 SP'},[product]).product).toBeNull();});
test('duplicate exact model is ambiguous and cannot be credited automatically',()=>expect(matchProduct(sale.lines[0],[product,{...product,id:'duplicate'}]).product).toBeNull());
test('preserves purchases from awaiting receipts and follows invoice references for display',()=>{expect(purchaseLines({items:[{id:1,name:'Battery',quantity:'2',total:'500'}]})).toMatchObject([{name:'Battery',quantity:2,netTotal:500}]);expect(purchaseLines({items:[{documentId:55}]},{'55':{items:[{id:1,name:'Battery',quantity:2,total:500}]}})).toHaveLength(1);});

test('group B and commission settings override defaults',()=>{const p=previewFlowSale(sale,[product],{...settings,membership_config:{groups:{[product.product]:{b:0.25,commission:0.02}}}});expect(p.lines[0].tc).toBe(35680);});
test('zero cost is unresolved rather than awarding all sale revenue',()=>expect(previewFlowSale(sale,[{...product,tier_2_price:0}],settings).lines[0].tc).toBeNull());
