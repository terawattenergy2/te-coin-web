import{render,screen,fireEvent,waitFor}from'@testing-library/react';
import App from'./App';import {parseFormula,formulaRules} from './formulas';import {defaults} from './coin';import{api,restoreSession}from'./api';
jest.mock('./api',()=>({connected:true,setSession:jest.fn(),restoreSession:jest.fn(),api:{login:jest.fn(),me:jest.fn(),read:jest.fn(),readAll:jest.fn(),catalog:jest.fn(),rpc:jest.fn()}}));
const account={id:'real-admin',email:'admin@example.test'};
const rows=Array.from({length:76},(_,i)=>({id:`db-${i}`,model:`Database Product ${i+1}`,main:'Resi',product:'Inverter',Qty:1,tier_2_price:700,epc_price:800}));
beforeEach(()=>{
 jest.clearAllMocks();restoreSession.mockReturnValue(null);api.me.mockResolvedValue(account);api.login.mockResolvedValue({access_token:'fixture-token',user:account});api.readAll.mockResolvedValue(rows);api.catalog.mockResolvedValue([]);api.rpc.mockResolvedValue([{column_name:'epc_price'}]);
 api.read.mockImplementation(async table=>table==='tc_profiles'?[{...account,role:'admin'}]:table==='tc_settings'?[{id:1,y:.5,commission:.015,baht_per_tc:.8,success_rate:.8}]:[]);
});
async function login(){
 fireEvent.change(screen.getByLabelText('อีเมล'),{target:{value:account.email}});fireEvent.change(screen.getByLabelText('รหัสผ่าน'),{target:{value:'fixture-password'}});
 fireEvent.click(screen.getAllByRole('button',{name:/เข้าสู่ระบบ/}).find(b=>b.type==='submit'));
 await screen.findByRole('button',{name:'จัดการระบบ'});
 fireEvent.click(screen.getByRole('button',{name:/สินค้าและราคา/}));
}
test('real login loads all 76 returned stock rows and never displays the 3 demo rows',async()=>{
 render(<App/>);await login();await screen.findByText('Database Product 76');
 expect(screen.getByText(/โหลดจาก Supabase แล้ว/)).toBeInTheDocument();expect(screen.getByText(/แสดง 76 จาก 76 รายการ/)).toBeInTheDocument();
 expect(screen.queryByText('Sigen PV 50M1')).not.toBeInTheDocument();expect(screen.queryByText(/Demo workspace/)).not.toBeInTheDocument();
 expect(api.readAll).toHaveBeenCalledWith('stock_profit');
});
test('a stock request failure remains visible on the stock page without fake fallback data',async()=>{
 api.readAll.mockRejectedValue(new Error('Stock permission denied'));render(<App/>);await login();
 expect(await screen.findByRole('alert')).toHaveTextContent('Stock permission denied');expect(screen.queryByText('Sigen PV 50M1')).not.toBeInTheDocument();
 expect(screen.getByText(/โหลดสินค้าจาก Supabase ไม่สำเร็จ/)).toBeInTheDocument();
});
test('load-real-data button reuses an existing real session instead of the demo identity',async()=>{
 restoreSession.mockReturnValueOnce(null).mockReturnValue({access_token:'fixture-token',refresh_token:'fixture-refresh'});
 render(<App/>);fireEvent.click(screen.getByText('ทดลองหน้าจอ (ข้อมูลตัวอย่าง)'));fireEvent.click(screen.getByRole('button',{name:'admin'}));fireEvent.click(screen.getByRole('button',{name:/สินค้าและราคา/}));
 fireEvent.click(screen.getByRole('button',{name:'โหลดข้อมูลจริงจาก Supabase'}));
 await screen.findByText('Database Product 76');expect(screen.queryByText(/Demo workspace/)).not.toBeInTheDocument();
 await waitFor(()=>expect(api.me).toHaveBeenCalled());
});

test('browser autofilled fields are submitted even before React onChange events',async()=>{
 render(<App/>);
 const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
 setter.call(screen.getByLabelText('อีเมล'),account.email);
 setter.call(screen.getByLabelText('รหัสผ่าน'),'browser-filled-fixture');
 const submit=screen.getAllByRole('button',{name:/เข้าสู่ระบบ/}).find(b=>b.type==='submit');
 fireEvent.submit(submit.closest('form'));
 await waitFor(()=>expect(api.login).toHaveBeenCalledWith(account.email,'browser-filled-fixture'));
});

test('real admin can edit reward B and save through existing formula RPC before membership migrations',async()=>{
 const rules={...formulaRules(defaults),reward_tc_2:parseFormula('ceil(value_baht / baht_per_tc)')};
 api.read.mockImplementation(async table=>table==='tc_profiles'?[{...account,role:'admin'}]:table==='tc_settings'?[{id:1,y:.5,commission:.015,baht_per_tc:.8,success_rate:.8,formulas:rules,formula_revision:4}]:table==='tc_rewards'?[{id:'voucher',option:2,name:'Voucher',value_baht:800,y:1,stock:10,active:true}]:[]);
 jest.spyOn(window,'confirm').mockReturnValue(true);render(<App/>);await login();await screen.findByText('Database Product 76');
 fireEvent.click(screen.getByRole('button',{name:'จัดการระบบ'}));
 fireEvent.click(screen.getByRole('button',{name:/ตั้งค่าระบบ/}));fireEvent.click(screen.getByRole('button',{name:'สูตรการคำนวณ'}));fireEvent.click(screen.getByRole('tab',{name:'TC แลกรางวัล'}));
 await waitFor(()=>expect(screen.getByLabelText('B สำหรับ Cashback / Voucher')).toBeEnabled());
 fireEvent.change(screen.getByLabelText('B สำหรับ Cashback / Voucher'),{target:{value:'1.5'}});fireEvent.click(screen.getByRole('button',{name:'บันทึก B และสูตรแลกรางวัล'}));
 await waitFor(()=>expect(api.rpc).toHaveBeenCalledWith('tc_save_formulas',expect.objectContaining({expected_revision:4,rules:expect.objectContaining({reward_tc_2:parseFormula('ceil(value_baht * 1.500000000000)')})})));
 expect(api.rpc).not.toHaveBeenCalledWith('tc_save_reward_formulas',expect.anything());window.confirm.mockRestore();
});
