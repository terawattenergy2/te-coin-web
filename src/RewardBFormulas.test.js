import{render,screen,fireEvent,within}from'@testing-library/react';
import FormulaEditor from'./FormulaEditor';import{defaults,initialProducts,initialRewards,rewardCost}from'./coin';import{formulaRules,evaluateTarget,formulaContext,parseFormula}from'./formulas';
test('reward tab edits B by type, previews actual reward value and saves B and formula together',()=>{
 const save=jest.fn();jest.spyOn(window,'confirm').mockReturnValue(true);
 render(<FormulaEditor settings={defaults} products={initialProducts} rewards={initialRewards} customers={[]} demo onSave={save}/>);
 fireEvent.click(screen.getByRole('tab',{name:'TC แลกรางวัล'}));fireEvent.change(screen.getByLabelText('B สำหรับ Cashback / Voucher'),{target:{value:'1.5'}});
 expect(within(screen.getByTestId('formula-reward_tc_2')).getByRole('status')).toHaveTextContent('1,200 TC');
 fireEvent.click(screen.getByRole('button',{name:'แก้สูตรTC แลก Cashback / Voucher'}));
 expect(screen.getByTestId('node-reward_tc_2-root-0-0-0-1-source')).toHaveValue('redemption_b');
 fireEvent.click(screen.getByRole('button',{name:'บันทึกและใช้สูตรทั้งหมด'}));
 const [rules,bs]=save.mock.calls[0];expect(bs).toEqual({'1':1,'2':1.5,'3':1,'4':1});
 expect(evaluateTarget('reward_tc_2',rules,formulaContext({},defaults,{value_baht:800,redemption_b:bs[2]}))).toBe(1200);
 expect(defaults.membership_config.groups['SigenStor Battery'].b).toBe(.5);window.confirm.mockRestore();
});
test('invalid B blocks saving and a missing database upgrade still permits editing B',()=>{
 const{unmount}=render(<FormulaEditor settings={defaults} products={initialProducts} rewards={initialRewards} customers={[]} demo onSave={()=>{}}/>);
 fireEvent.click(screen.getByRole('tab',{name:'TC แลกรางวัล'}));fireEvent.change(screen.getByLabelText('B สำหรับ Bundle Set'),{target:{value:'0'}});expect(screen.getByRole('button',{name:'บันทึกและใช้สูตรทั้งหมด'})).toBeDisabled();
 unmount();render(<FormulaEditor settings={{...defaults,reward_formula_version:0,formulas:formulaRules(defaults)}} products={initialProducts} rewards={initialRewards} customers={[]} demo={false} onSave={()=>{}}/>);fireEvent.click(screen.getByRole('tab',{name:'TC แลกรางวัล'}));expect(screen.getByLabelText('B สำหรับ Bundle Set')).toBeEnabled();
});
test('custom formulas can still reference old D explicitly without changing default B multiplication',()=>{
 const settings={...defaults,formulas:{reward_tc_2:parseFormula('value_baht / redemption_d')}};
 expect(rewardCost({option:2,value_baht:800,redemption_d:.5,redemption_b:1.5},settings)).toBe(1600);
 expect(rewardCost({option:2,value_baht:800,redemption_d:.5,redemption_b:1.5},defaults)).toBe(1200);
});

test('legacy database saves B in existing formula and restores it after reloading without 007',()=>{
 const save=jest.fn();jest.spyOn(window,'confirm').mockReturnValue(true);
 const settings={...defaults,membership_version:1,reward_formula_version:0,membership_config:{groups:{}},formulas:{...formulaRules(defaults),reward_tc_2:parseFormula('ceil(value_baht / (baht_per_tc * reward_y))')}};
 const props={settings,products:initialProducts,rewards:initialRewards,customers:[],demo:false,onSave:save};
 const view=render(<FormulaEditor {...props}/>);fireEvent.click(screen.getByRole('tab',{name:'TC แลกรางวัล'}));
 fireEvent.change(screen.getByLabelText('B สำหรับ Cashback / Voucher'),{target:{value:'1.5'}});
 expect(within(screen.getByTestId('formula-reward_tc_2')).getByRole('status')).toHaveTextContent('1,200 TC');
 fireEvent.click(screen.getByRole('button',{name:'บันทึก B และสูตรแลกรางวัล'}));
 const [rules,bs]=save.mock.calls[0];expect(bs).toBeUndefined();expect(rules.reward_tc_2).toEqual(parseFormula('ceil(value_baht * 1.500000000000)'));
 view.unmount();render(<FormulaEditor {...props} settings={{...settings,formulas:rules}}/>);fireEvent.click(screen.getByRole('tab',{name:'TC แลกรางวัล'}));expect(screen.getByLabelText('B สำหรับ Cashback / Voucher')).toHaveValue(1.5);
 expect(rewardCost({...initialRewards[1],value_baht:800},{...settings,formulas:rules})).toBe(1200);
 window.confirm.mockRestore();
});
test('legacy TC ceiling and per-reward overrides match the existing server',()=>{
 const settings={...defaults,reward_formula_version:0,formulas:{reward_tc_2:parseFormula('ceil(value_baht * 1.5)')}};
 expect(rewardCost({option:2,value_baht:.07},settings)).toBe(1);
 expect(rewardCost({option:2,value_baht:800,tc_base:200,tc_indicator:2},settings)).toBe(400);
});
