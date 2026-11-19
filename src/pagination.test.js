import { readAllRows } from './pagination';
test('loads beyond the first response including shortened server pages',async()=>{
 const rows=Array.from({length:1203},(_,id)=>({id}));
 const read=jest.fn(async offset=>rows.slice(offset,offset+100));
 const result=await readAllRows(read);
 expect(result).toEqual(rows);expect(read).toHaveBeenLastCalledWith(1203);
});
test('does not return partial data on a later page error',async()=>{
 await expect(readAllRows(async offset=>{if(offset)throw new Error('denied');return [{id:1}];})).rejects.toThrow('denied');
});
