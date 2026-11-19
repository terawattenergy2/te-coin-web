import {render,screen,fireEvent} from '@testing-library/react';
import SettingsFields from './SettingsFields';
import SaleForm from './SaleForm';
import {defaults} from './coin';
const products=[{id:'b',product:'SigenStor Battery',model:'BAT10',tier_2_price:72600,epc_price:84500,Qty:50}];
test('admin edits each assumption from settings and saves group B separately',()=>{
 const save=jest.fn();render(<SettingsFields products={products} settings={defaults} onSave={save}/>);
 fireEvent.change(screen.getByLabelText('ตัวคูณ B SigenStor Battery'),{target:{value:'0.25'}});
 fireEvent.change(screen.getByLabelText('อัตราสำรอง Liability (บาท / TC)'),{target:{value:'0.7'}});
 fireEvent.click(screen.getByRole('button',{name:'บันทึกการตั้งค่า'}));expect(save).toHaveBeenCalledWith(expect.objectContaining({baht_per_tc:.7,membership_config:expect.objectContaining({groups:expect.objectContaining({'SigenStor Battery':{b:.25}})})}));
});
test('sale preview shows actual sale price, gross margin A, group B, and earned C',()=>{
 render(<SaleForm products={products} customers={[{customer_id:'c',customer_name:'Customer'}]} profiles={[]} settings={defaults} onSave={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('สินค้า'),{target:{value:'b'}});fireEvent.change(screen.getByLabelText('ราคาขายจริงก่อน VAT / หน่วย (บาท)'),{target:{value:'82700'}});fireEvent.change(screen.getByLabelText('จำนวนที่ขาย'),{target:{value:'4'}});
 const line=document.querySelector('.sale-line');expect(line).toHaveTextContent('35,438 บาท');expect(line).toHaveTextContent('17,719 TC');expect(line).toHaveTextContent('4,962 บาท');
 fireEvent.change(screen.getByLabelText('คอมมิชชันของรายการ (0.015 = 1.5%)'),{target:{value:'0.012'}});expect(line).toHaveTextContent('18,215.2 TC');
 fireEvent.click(screen.getByRole('button',{name:'+ เพิ่มรายการสินค้า'}));expect(screen.getAllByLabelText('สินค้า')).toHaveLength(2);
});
