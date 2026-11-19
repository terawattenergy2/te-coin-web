import{parseFormula,evaluateTarget,formulaRules,formulaContext}from'./formulas';
import{splitFormula,joinFormula,formulaSteps,replaceFormulaNode}from'./formulaSteps';
test('simplified guard controls preserve earning math for profits, losses, quantities and rounding',()=>{
 const rules=formulaRules({});const spec=splitFormula(rules.earned_tc);expect(formulaSteps(spec.body)).toHaveLength(2);
 const rebuilt={...rules,earned_tc:joinFormula(spec)};
 for(const[epc,tier,quantity]of[[81300,74400,1],[81300,74400,2],[1,2,1],[2,1,3]]){
  const context=formulaContext({epc_price:epc,tier_2_price:tier},{},{quantity});expect(evaluateTarget('earned_tc',rebuilt,context)).toBe(evaluateTarget('earned_tc',rules,context));
 }
});
test('editing a flat step preserves its position and division parentheses',()=>{
 const original=parseFormula('epc_price / (tier_2_price - 100)');const next=replaceFormulaNode(original,'root-1-0',{var:'tier_2_cost'});
 expect(evaluateTarget('test',{test:next},{epc_price:1000,tier_2_cost:600})).toBe(2);expect(original.args[1].args[0].var).toBe('tier_2_price');
});
