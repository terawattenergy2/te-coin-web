import{render,screen,fireEvent,within}from'@testing-library/react';
import FormulaEditor from'./FormulaEditor';
import{defaults,initialRewards}from'./coin';
const products=[{id:'1',model:'Test',Qty:10,tier_2_price:74400,tier_2_cost:74400,epc_price:81300,enduser_price:101700}];
const props={settings:defaults,products,customers:[],rewards:initialRewards,demo:true};
test('price operands are dropdowns with Thai names and changing them saves the correct AST',()=>{
 const onSave=jest.fn();jest.spyOn(window,'confirm').mockReturnValue(true);render(<FormulaEditor {...props} onSave={onSave}/>);
 fireEvent.click(screen.getByRole('button',{name:'แก้สูตรกำไรขั้นต้นต่อหน่วย'}));
 const price=screen.getByTestId('node-gross_margin-root-0-0-source');
 expect(price.querySelector('option[value="tier_2_price"]').textContent).toBe('ราคา Tier 2 ปกติ');
 expect(price.querySelector('option[value="tier_2_cost"]').textContent).toBe('ต้นทุนฐาน (Tier 2)');
 expect(price.querySelector('option[value="epc_price"]').textContent).toBe('ราคาขาย EPC');
 expect(price.querySelector('option[value="enduser_price"]').textContent).toBe('ราคาขาย Enduser');
 expect(document.querySelector('textarea')).toBeNull();
 fireEvent.change(price,{target:{value:'enduser_price'}});
 fireEvent.change(screen.getByTestId('node-gross_margin-root-0-1-source'),{target:{value:'tier_2_cost'}});
 expect(within(screen.getByTestId('formula-gross_margin')).getByRole('status')).toHaveTextContent('26,080.5');
 fireEvent.click(screen.getByRole('button',{name:'บันทึกและใช้สูตรทั้งหมด'}));
 const rules=onSave.mock.calls[0][0];expect(rules.gross_margin.args[0].args[0].var).toBe('enduser_price');expect(rules.gross_margin.args[0].args[1].var).toBe('tier_2_cost');
 window.confirm.mockRestore();
});
test('operators and literal values are selectable and divide by zero blocks saving',()=>{
 render(<FormulaEditor {...props} onSave={()=>{}}/>);
 fireEvent.change(screen.getByTestId('node-commission_amount-root-operation'),{target:{value:'div'}});
 fireEvent.change(screen.getByTestId('node-commission_amount-root-1-source'),{target:{value:'@number'}});
 expect(screen.getAllByText(/ไม่สามารถหารด้วยศูนย์/).length).toBeGreaterThan(0);
 expect(screen.getByRole('button',{name:'บันทึกและใช้สูตรทั้งหมด'})).toBeDisabled();
});
test('new column formulas are selected from database columns with Thai labels',()=>{
 render(<FormulaEditor {...props} products={[...products,{id:'2',model:'Other',epc_profit:6900}]} onSave={()=>{}}/>);
 const picker=screen.getByLabelText('เลือกช่องข้อมูลที่ต้องการตั้งสูตร');
 expect(picker.querySelector('option[value="epc_profit"]').textContent).toBe('กำไร EPC / หน่วย');
 fireEvent.change(picker,{target:{value:'epc_profit'}});fireEvent.click(screen.getByRole('button',{name:'+ เพิ่มสูตร'}));
 expect(screen.getByTestId('formula-epc_profit')).toBeInTheDocument();
 expect(screen.getByTestId('node-epc_profit-root-source')).toHaveValue('raw_epc_profit');
});
