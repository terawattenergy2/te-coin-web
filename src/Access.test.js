import {render,screen,fireEvent} from '@testing-library/react';
import CustomerCatalog from './CustomerCatalog';
import UserAccess from './UserAccess';
test('pending customer sees approval notice and no product price',()=>{
 render(<CustomerCatalog products={[]} tier={null} onRefresh={()=>{}}/>);
 expect(screen.getByText(/รอ Admin อนุมัติ/)).toBeInTheDocument();
});
test('customer catalog renders only the assigned unit price and excludes raw cost fields',()=>{
 render(<CustomerCatalog products={[{id:'1',model:'Sigen 50',unit_price:81300,tier_2_cost:74400,qty:2}]} tier="epc_price" onRefresh={()=>{}}/>);
 expect(screen.getByText('81,300.00 บาท')).toBeInTheDocument();
 expect(screen.queryByText(/74,400/)).not.toBeInTheDocument();
});
test('admin selects price level for a customer and cannot change own role',()=>{
 const assign=jest.fn();render(<UserAccess profiles={[{id:'admin',role:'admin',customer_name:'Owner'},{id:'customer',role:'customer',customer_name:'Client',price_column:null}]} priceColumns={['tier_2_price','epc_price']} userId="admin" onRole={()=>{}} onPrice={assign}/>);
 expect(screen.getAllByLabelText('สิทธิ์การใช้งาน')[0]).toBeDisabled();
 fireEvent.change(screen.getByLabelText('ระดับราคาที่ซื้อได้'),{target:{value:'epc_price'}});
 expect(assign).toHaveBeenCalledWith('customer','epc_price');
});
