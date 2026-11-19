import{parseFormula,printFormula,evaluateTarget,formulaRules,formulaContext,customerMetric,computedProduct}from'./formulas';
const compute=(s,ctx={})=>evaluateTarget('answer',{answer:parseFormula(s)},ctx);
test('supports selected price columns, arithmetic precedence, brackets, unary operations and decimal rounding',()=>{
 expect(compute('epc_price - (tier_2_price * 1.015)',{epc_price:81300,tier_2_price:74400})).toBeCloseTo(5784,8);
 expect(compute('10 + 2 * 3')).toBe(16);expect(compute('(10 + 2) * 3')).toBe(36);
 expect(compute('round(-1.235, 2)')).toBe(-1.24);expect(compute('ceil(55000 / 0.8)')).toBe(68750);
 expect(compute('max(0, min(2, abs(-3)))')).toBe(2);
});
test('rejects executable code, unknown functions, malformed formulas, missing variables and zero division',()=>{
 for(const source of ['alert(1)','1;drop table stock_profit','window.location','1 +','(1 + 2','round(1,2,3)'])expect(()=>parseFormula(source)).toThrow();
 expect(()=>compute('missing + 1')).toThrow('ไม่พบ');expect(()=>compute('1 / 0')).toThrow('ศูนย์');
});
test('actual sale price is independent of edited catalog EPC prices; raw formula dependencies remain safe',()=>{
 const settings={y:.5,commission:.015,baht_per_tc:.8,success_rate:.8,formulas:{epc_price:parseFormula('raw_epc_price + 1000')}};
 const raw={epc_price:81300,tier_2_price:74400};const rules=formulaRules(settings),ctx=formulaContext(raw,settings);
 expect(evaluateTarget('gross_margin',rules,ctx)).toBe(5680.5);
 expect(computedProduct(raw,settings).epc_price).toBe(82300);expect(raw.epc_price).toBe(81300);
 expect(()=>evaluateTarget('a',{a:parseFormula('b+1'),b:parseFormula('a+1')},{})).toThrow('วนซ้ำ');
});
test('customer liability can be changed separately from valuation',()=>{
 const settings={baht_per_tc:.8,formulas:{liability_amount:parseFormula('tc_value * 0.5')}};
 expect(customerMetric('tc_value',{banlance_tc:1000},settings)).toBe(800);
 expect(customerMetric('liability_amount',{banlance_tc:1000},settings)).toBe(400);
});
test('formula string round-trips to its safe AST',()=>{
 const ast=parseFormula('max(0, (epc_price-tier_2_price)*quantity)');expect(parseFormula(printFormula(ast))).toEqual(ast);
});
