// Continue even if the server returns fewer rows than requested (its own row cap).
export async function readAllRows(readPage) {
 const rows=[];
 while(true){
  const page=await readPage(rows.length);
  if(!Array.isArray(page))throw new Error('รูปแบบข้อมูลจาก Supabase ไม่ถูกต้อง');
  if(!page.length)return rows;
  rows.push(...page);
 }
}
