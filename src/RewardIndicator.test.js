import{fireEvent,render,screen}from'@testing-library/react';
import RewardEditor from'./RewardEditor';
import{rewardCost,defaults,luckyProbability}from'./coin';
const reward={id:'r1',option:2,name:'Voucher',description:'',value_baht:800,y:1,stock:10,active:true};
test('reward value multiplies an independent B; increasing B increases the TC price',()=>{
 expect(rewardCost({...reward,redemption_b:.5},defaults)).toBe(400);
 expect(rewardCost({...reward,redemption_b:1.5},defaults)).toBe(1200);
 expect(rewardCost({...reward,value_baht:1.1,redemption_b:100},defaults)).toBe(110);
 expect(rewardCost({...reward,value_baht:100,redemption_b:.333333},defaults)).toBe(33.34);
 expect(rewardCost({...reward,value_baht:.07,redemption_b:1},defaults)).toBe(.07);
 expect(()=>rewardCost({...reward,redemption_b:0},defaults)).toThrow();
});
test('admin changes and saves reward B with visible multiplication',()=>{
 const save=jest.fn();render(<RewardEditor value={reward} settings={defaults} onClose={()=>{}} onSave={save}/>);
 fireEvent.change(screen.getByLabelText('B เฉพาะรางวัลนี้ (เว้นว่างใช้ B ของประเภท)'),{target:{value:'1.5'}});
 expect(screen.getByRole('status')).toHaveTextContent('800 บาท × B 1.5');expect(screen.getByRole('status')).toHaveTextContent('ใช้ 1,200 TC');
 fireEvent.click(screen.getByRole('button',{name:'บันทึกรางวัลและ B'}));expect(save).toHaveBeenCalledWith(expect.objectContaining({id:'r1',redemption_b:1.5}));
});
test('clearing a per-reward override uses its type B without affecting earning B or liability',()=>{
 const settings={...defaults,membership_config:{...defaults.membership_config,reward_b:{2:2}}};
 const save=jest.fn();render(<RewardEditor value={{...reward,redemption_b:.5}} settings={settings} onClose={()=>{}} onSave={save}/>);
 fireEvent.change(screen.getByLabelText('B เฉพาะรางวัลนี้ (เว้นว่างใช้ B ของประเภท)'),{target:{value:''}});
 // Empty is equivalent to an absent override while editing.
 expect(screen.getByRole('status')).toHaveTextContent('ใช้ 1,600 TC');
 fireEvent.click(screen.getByRole('button',{name:'บันทึกรางวัลและ B'}));expect(save).toHaveBeenCalledWith(expect.objectContaining({redemption_b:null}));
});
test('Lucky Draw assumption can be overridden per reward, including zero',()=>{
 expect(luckyProbability(defaults,{win_rate:0})).toBe(0);expect(luckyProbability(defaults,{win_rate:.9})).toBe(.9);expect(luckyProbability(defaults)).toBe(.8);
});
