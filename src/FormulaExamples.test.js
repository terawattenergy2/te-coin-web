import{render,screen,fireEvent,within}from'@testing-library/react';
import FormulaEditor from'./FormulaEditor';import{defaults,initialRewards}from'./coin';
const props={settings:defaults,products:[{id:'ec10',model:'SigenStor EC 10.0 SP',Qty:248,tier_2_price:60600,tier_2_cost:60600,epc_price:70600,enduser_price:76400}],rewards:initialRewards,customers:[],demo:true,onSave:()=>{}};
test('shows real example prices, percentage rate and the numeric substitution 70600 x .015 = 1059',()=>{
 render(<FormulaEditor {...props}/>);
 const card=within(screen.getByTestId('formula-commission_amount'));
 expect(card.getByText('70,600 บาท')).toBeInTheDocument();expect(card.getByText('1.5% (0.015)')).toBeInTheDocument();
 expect(card.getByText('70,600 × 0.015 = 1,059')).toBeInTheDocument();expect(card.getByRole('status')).toHaveTextContent('1,059 บาท');
 const overview=screen.getByLabelText('ราคาของสินค้าตัวอย่าง');expect(overview).toHaveTextContent('70,600 บาท');expect(overview).toHaveTextContent('76,400 บาท');
});
test('earning formula uses two flat steps and simple guard controls instead of nested operation panels',()=>{
 render(<FormulaEditor {...props}/>);fireEvent.click(screen.getByRole('button',{name:'แก้สูตรTC ที่ได้รับจากการขาย'}));
 const card=screen.getByTestId('formula-earned_tc');expect(card.querySelectorAll('.simple-step')).toHaveLength(2);expect(card.querySelectorAll('.formula-operation-node')).toHaveLength(0);
 expect(within(card).getByRole('checkbox')).toBeChecked();expect(screen.getByLabelText('การปัดเศษ TC ที่ได้รับจากการขาย')).toHaveValue('round');expect(screen.getByLabelText('ทศนิยม TC ที่ได้รับจากการขาย')).toHaveValue('2');
 fireEvent.change(screen.getByLabelText('จำนวนในรายการขาย'),{target:{value:'2'}});expect(within(card).getByRole('status')).toHaveTextContent('8,941 TC');
});
test('changing sample product updates source badges and commission, without editing the formula',()=>{
 render(<FormulaEditor {...props} products={[...props.products,{id:'pv',model:'PV 50',tier_2_price:74400,epc_price:81300,Qty:2}]}/>);
 fireEvent.change(screen.getByLabelText('สินค้าตัวอย่าง'),{target:{value:'pv'}});
 const card=within(screen.getByTestId('formula-commission_amount'));expect(card.getByText('81,300 บาท')).toBeInTheDocument();expect(card.getByRole('status')).toHaveTextContent('1,219.5 บาท');
});

test('gross margin is a baht amount, not a percentage',()=>{
 render(<FormulaEditor {...props}/>);
 expect(within(screen.getByTestId('formula-gross_margin')).getByRole('status')).toHaveTextContent('8,941 บาท');
});

test('sample quantity scales the displayed baht totals and TC while keeping per-unit inputs and rates', () => {
 render(<FormulaEditor {...props}/>);
 fireEvent.change(screen.getByLabelText('จำนวนในรายการขาย'), {target: {value: '5'}});
 const overview = within(screen.getByLabelText('ราคาของสินค้าตัวอย่าง'));
 expect(overview.getAllByText('353,000 บาท')).toHaveLength(2);
 expect(overview.getAllByText('303,000 บาท')).toHaveLength(3);
 expect(overview.getByText('382,000 บาท')).toBeInTheDocument();
 expect(overview.getByText('1.5% (0.015)')).toBeInTheDocument();
 expect(screen.getByLabelText('ราคาขายตัวอย่างก่อน VAT / หน่วย')).toHaveValue(70600);
 expect(screen.getByTestId('formula-commission_amount')).toHaveTextContent('รวม 5 ชิ้น · 5,295 บาท');
 expect(screen.getByTestId('formula-gross_margin')).toHaveTextContent('รวม 5 ชิ้น · 44,705 บาท');
 expect(screen.getByTestId('formula-earned_tc')).toHaveTextContent('22,352.5 TC');
});

test('typing suggests sample products and the original selector still works', () => {
 render(<FormulaEditor {...props} products={[
  ...props.products,
  {id:'pv', model:'PV 50', product:'Solar Panel', tier_2_price:74400, epc_price:81300},
 ]}/>);
 const search = screen.getByRole('searchbox', {name:'ค้นหาสินค้าตัวอย่าง'});
 const picker = screen.getByLabelText('สินค้าตัวอย่าง');
 fireEvent.change(search, {target:{value:'no matches'}});
 expect(screen.getByText('ไม่พบสินค้าที่ตรงกับคำค้น')).toBeInTheDocument();
 fireEvent.change(search, {target:{value:'panel pV'}});
 const suggestions = within(screen.getByRole('list', {name:'สินค้าแนะนำ'}));
 expect(suggestions.getAllByRole('button')).toHaveLength(1);
 fireEvent.click(suggestions.getByRole('button', {name:/PV 50/}));
 expect(search).toHaveValue('');
 expect(picker).toHaveValue('pv');
 expect(screen.getByLabelText('ราคาขายตัวอย่างก่อน VAT / หน่วย')).toHaveValue(81300);
 fireEvent.change(picker, {target:{value:'ec10'}});
 expect(screen.getByLabelText('ราคาขายตัวอย่างก่อน VAT / หน่วย')).toHaveValue(70600);
});
